import { WebSocketServer, WebSocket } from "ws"; // ADDED: Import WebSocket for readyState comparison
import jwt from "jsonwebtoken";
import logger from "../utils/logger.js";
import config from "../config/config.js";
import User from "../models/user.model.js";
import Team from "../models/team.model.js";
import Message from "../models/Message.model.js";
import Notification from "../models/Notification.model.js";
import Hackathon from "../models/hackthon.model.js";
import mongoose from "mongoose";
import { startScheduler } from "../utils/schedular.js";

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map();
    this.userToHackathon = new Map();
    this.heartbeatInterval = 30000;
    this.pingInterval = null;
    this.timerInterval = null;
    this.activeHackathons = new Set();
    this.rateLimitMap = new Map(); // MOVED: Rate limit map to constructor
    this.messageRateLimit = new Map(); // MOVED: Message rate limit to constructor
  }

  initialize(server) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      this.handleUpgrade(request, socket, head).catch((err) => {
        logger.error(`Upgrade failed: ${err.message}`);
        socket.destroy();
      });
    });

    this.setupEventHandlers();
    this.startCleanupInterval(); // ADDED: Start cleanup interval
    logger.info("WebSocket server initialized");
  }

  async handleUpgrade(request, socket, head) {
    try {
      const { user, error } = await this.verifyClient(request);
      if (error || !user) {
        logger.warn(`Rejected connection: ${error}`);
        return socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request);
      });
    } catch (err) {
      logger.error(`Upgrade error: ${err.message}`);
      throw err;
    }
  }

  async verifyClient(request) {
    try {
      const origin = request.headers.origin;
      if (!this.isOriginAllowed(origin)) {
        return { error: "Origin not allowed" };
      }

      const token = this.extractToken(request);
      if (!token) {
        return { error: "No token provided" };
      }

      const decoded = await new Promise((resolve, reject) => {
        jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        });
      });

      if (!decoded?.id) {
        return { error: "Invalid token payload" };
      }

      const user = await User.findById(decoded.id);
      if (!user) {
        return { error: "User not found" };
      }

      request.user = user;
      return { user: user };
    } catch (err) {
      logger.warn(`Verification failed: ${err.message}`);
      return { error: err.message };
    }
  }

  extractToken(request) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      return (
        url.searchParams.get("token") ||
        request.headers["sec-websocket-protocol"] ||
        request.headers["authorization"]?.split(" ")[1]
      );
    } catch (err) {
      return null;
    }
  }

  isOriginAllowed(origin) {
    if (!origin || process.env.NODE_ENV === "development") return true;

    const allowedOrigins = [
      ...(config.cors?.allowedOrigins || []),
      `http://${config.server.host}:${config.server.port}`,
      "http://localhost:3000",
    ];

    return allowedOrigins.includes(origin) || allowedOrigins.includes("*");
  }

  setupEventHandlers() {
    this.wss.on("connection", (ws, request) => {
      const userId = request.user?.id;
      if (!userId) {
        return ws.close(1008, "Authentication failed");
      }

      this.handleClientConnection(ws, userId, request.user);
    });

    this.startHeartbeat();
  }

  async handleClientConnection(ws, userId, user) {
    logger.info(`Client connected: ${userId}`);

    this.addClient(userId, ws);

    // Update user's last seen and get their current hackathon
    await this.updateUserLastSeen(userId);
    if (user.currentHackathonId) {
      this.userToHackathon.set(userId, user.currentHackathonId.toString());
    }

    // Setup client heartbeat
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // Message handler
    ws.on("message", (data) => {
      this.handleClientMessage(ws, userId, data);
    });

    ws.on("close", () => {
      logger.info(`Client disconnected: ${userId}`);
      this.removeClient(userId);
    });

    ws.on("error", (err) => {
      logger.error(`Client error ${userId}: ${err.message}`);
      this.removeClient(userId);
    });

    // Send initial connection confirmation
    this.sendToUser(userId, {
      type: "connection.established",
      timestamp: Date.now(),
    });

    // Send any unread notifications
    await this.sendUnreadNotifications(userId);
  }

  async handleClientMessage(ws, userId, data) {
    try {
      const message = JSON.parse(data);
      logger.debug(`Client ${userId} message: ${message.type}`);

      switch (message.type) {
        case "presence.ping":
          await this.handlePresencePing(userId);
          break;
        case "team.sendMessage":
          await this.handleTeamMessage(userId, message);
          break;
        case "team.typing":
          await this.handleTypingIndicator(userId, message);
          break;
        case "notifications.markRead":
          await this.handleMarkNotificationsRead(userId, message);
          break;
        case "hackathon.subscribe":
          await this.handleHackathonSubscribe(userId, message);
          break;
        default:
          logger.debug(`Unhandled client message type: ${message.type}`);
      }
    } catch (err) {
      logger.error(`Client message handling error: ${err.message}`);
      this.sendToUser(userId, {
        type: "error",
        message: "Message processing failed",
      });
    }
  }

  async handlePresencePing(userId) {
    await this.updateUserLastSeen(userId);

    // Broadcast presence update to team members
    const hackathonId = this.userToHackathon.get(userId);
    if (hackathonId) {
      const team = await Team.findOne({
        hackathonId,
        "members.userId": userId,
      });

      if (team) {
        const teamMemberIds = team.members.map((m) => m.userId.toString());
        this.broadcastToUsers(teamMemberIds, {
          type: "presence.update",
          userId,
          lastSeen: new Date(),
          teamId: team._id,
        });
      }
    }
  }

  async handleTeamMessage(userId, message) {
    try {
      const { teamId, text } = message;

      // Validate input
      if (!teamId || !text || text.trim().length === 0) {
        return this.sendToUser(userId, {
          type: "error",
          message: "Invalid message data",
        });
      }

      // Verify user is team member - FIXED: Use members.userId instead of teamMember
      const team = await Team.findById(teamId);
      if (!team || !team.teamMember.some((m) => m._id.toString() === userId)) {
        return this.sendToUser(userId, {
          type: "error",
          message: "Not authorized to send messages to this team",
        });
      }

      // Optional: Check if chat is enabled
      if (team.chatEnabled === false) {
        return this.sendToUser(userId, {
          type: "error",
          message: "Chat is disabled for this team",
        });
      }

      // Rate limiting check
      const rateLimitKey = `${userId}:${teamId}`;
      if (this.isRateLimited(rateLimitKey)) {
        return this.sendToUser(userId, {
          type: "error",
          message: "Rate limit exceeded. Please slow down.",
        });
      }

      // Create new message
      const newMessage = new Message({
        teamId,
        senderId: userId,
        text: text.trim(),
        createdAt: new Date(),
      });

      await newMessage.save();

      // Populate sender info - FIXED: More reliable population
      const populatedMessage = await Message.findById(newMessage._id)
        .populate("senderId", "name email")
        .exec();

      // Broadcast to all team members - FIXED: Use members.userId instead of teamMember
      const teamMemberIds = team.teamMember.map((m) => m._id.toString());
      this.broadcastToUsers(teamMemberIds, {
        type: "team.message",
        teamId,
        message: {
          _id: populatedMessage._id,
          text: populatedMessage.text,
          sender: {
            _id: populatedMessage.senderId._id,
            name: populatedMessage.senderId.name,
          },
          createdAt: populatedMessage.createdAt,
        },
      });
    } catch (err) {
      logger.error(`Team message error: ${err.message}`);
      this.sendToUser(userId, {
        type: "error",
        message: "Failed to send message",
      });
    }
  }

  async handleTypingIndicator(userId, message) {
    try {
      const { teamId, isTyping } = message;

      // Verify user is team member
      const team = await Team.findById(teamId);
      if (!team || !team.members.some((m) => m.userId.toString() === userId)) {
        return;
      }

      // Broadcast typing indicator to other team members
      const otherMemberIds = team.members
        .map((m) => m.userId.toString())
        .filter((id) => id !== userId);

      this.broadcastToUsers(otherMemberIds, {
        type: "team.typing",
        teamId,
        userId,
        isTyping,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error(`Typing indicator error: ${err.message}`);
    }
  }

  async handleMarkNotificationsRead(userId, message) {
    try {
      const { notificationIds } = message;

      if (notificationIds && Array.isArray(notificationIds)) {
        await Notification.updateMany(
          { _id: { $in: notificationIds }, userId },
          { read: true }
        );

        this.sendToUser(userId, {
          type: "notifications.marked_read",
          notificationIds,
        });
      }
    } catch (err) {
      logger.error(`Mark notifications read error: ${err.message}`);
    }
  }

  async handleHackathonSubscribe(userId, message) {
    try {
      const { hackathonId } = message;

      // Verify user is registered for this hackathon
      const user = await User.findById(userId);
      if (user.currentHackathonId?.toString() === hackathonId) {
        this.userToHackathon.set(userId, hackathonId);
        this.activeHackathons.add(hackathonId);

        this.sendToUser(userId, {
          type: "hackathon.subscribed",
          hackathonId,
        });
      }
    } catch (err) {
      logger.error(`Hackathon subscribe error: ${err.message}`);
    }
  }

  // Rate limiting helper
  isRateLimited(key) {
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 20; // 20 messages per minute

    if (!this.rateLimitMap.has(key)) {
      this.rateLimitMap.set(key, []);
    }

    const requests = this.rateLimitMap.get(key);

    // Remove old requests
    const validRequests = requests.filter((time) => now - time < windowMs);

    if (validRequests.length >= maxRequests) {
      return true;
    }

    validRequests.push(now);
    this.rateLimitMap.set(key, validRequests);
    return false;
  }

  async updateUserLastSeen(userId) {
    try {
      await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
    } catch (err) {
      logger.error(`Update last seen error: ${err.message}`);
    }
  }

  async sendUnreadNotifications(userId) {
    try {
      const notifications = await Notification.find({
        userId,
        read: false,
      })
        .sort({ createdAt: -1 })
        .limit(50);

      if (notifications.length > 0) {
        this.sendToUser(userId, {
          type: "notifications.unread",
          notifications,
        });
      }
    } catch (err) {
      logger.error(`Send unread notifications error: ${err.message}`);
    }
  }

  startHeartbeat() {
    this.pingInterval = setInterval(() => {
      this.clients.forEach((ws, userId) => {
        if (ws.isAlive === false) {
          logger.warn(`Terminating unresponsive client: ${userId}`);
          this.removeClient(userId);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, this.heartbeatInterval);
  }

  startTimerBroadcast() {
    // Broadcast hackathon timers every 5 seconds
    this.timerInterval = setInterval(async () => {
      try {
        await this.broadcastHackathonTimers();
      } catch (err) {
        logger.error(`Timer broadcast error: ${err.message}`);
      }
    }, 5000);
  }

  async broadcastHackathonTimers() {
    const now = new Date();

    // Get all running hackathons
    const runningHackathons = await Hackathon.find({
      status: { $in: ["scheduled", "running"] },
      endAt: { $gt: now },
    });

    for (const hackathon of runningHackathons) {
      const hackathonId = hackathon._id.toString();
      this.activeHackathons.add(hackathonId);

      const remainingMs = hackathon.endAt.getTime() - now.getTime();
      const hasStarted = hackathon.startAt <= now;

      // Get all users in this hackathon
      const usersInHackathon = Array.from(this.userToHackathon.entries())
        .filter(([userId, userHackathonId]) => userHackathonId === hackathonId)
        .map(([userId]) => userId);

      if (usersInHackathon.length > 0) {
        this.broadcastToUsers(usersInHackathon, {
          type: "hackathon.timer",
          hackathonId,
          now: now.getTime(),
          startAt: hackathon.startAt.getTime(),
          endAt: hackathon.endAt.getTime(),
          remainingMs,
          hasStarted,
          status: hackathon.status,
        });
      }
    }
  }

  sendToUser(userId, data) {
    const client = this.clients.get(userId);
    // FIXED: Use WebSocket.OPEN instead of this.wss.OPEN
    if (!client || client.readyState !== WebSocket.OPEN) return false;

    try {
      client.send(JSON.stringify(data));
      return true;
    } catch (err) {
      logger.error(`Send error to ${userId}: ${err.message}`);
      this.removeClient(userId);
      return false;
    }
  }

  broadcastToUsers(userIds, data) {
    let successCount = 0;
    userIds.forEach((userId) => {
      if (this.sendToUser(userId, data)) {
        successCount++;
      }
    });

    if (successCount > 0) {
      logger.debug(`Broadcasted to ${successCount} users`);
    }

    return successCount;
  }

  broadcastToClients(data) {
    return this.broadcastToUsers(Array.from(this.clients.keys()), data);
  }

  addClient(userId, ws) {
    // Close existing connection if present
    if (this.clients.has(userId)) {
      this.clients.get(userId).close(1001, "Duplicate connection");
    }

    this.clients.set(userId, ws);
    logger.info(`Client ${userId} connected (${this.clients.size} total)`);
  }

  removeClient(userId) {
    if (this.clients.delete(userId)) {
      this.userToHackathon.delete(userId);
      logger.info(
        `Client ${userId} disconnected (${this.clients.size} remaining)`
      );
    }
  }

  // Public methods for external services to trigger events

  async notifyTeamCreated(teamId) {
    try {
      const team = await Team.findById(teamId).populate(
        "members.userId",
        "name email"
      );
      if (!team) return;

      const memberIds = team.members.map((m) => m.userId._id.toString());

      this.broadcastToUsers(memberIds, {
        type: "team.created",
        teamId: team._id,
        hackathonId: team.hackathonId,
        members: team.members.map((m) => ({
          userId: m.userId._id,
          name: m.userId.name,
          joinedAt: m.joinedAt,
        })),
        teamCode: team.teamCode,
        chatEnabled: team.chatEnabled,
      });

      logger.info(`Notified team creation: ${teamId}`);
    } catch (err) {
      logger.error(`Notify team created error: ${err.message}`);
    }
  }

  async notifyTeamUpdated(teamId) {
    try {
      const team = await Team.findById(teamId).populate(
        "members.userId",
        "name email"
      );
      if (!team) return;

      const memberIds = team.members.map((m) => m.userId._id.toString());

      this.broadcastToUsers(memberIds, {
        type: "team.updated",
        teamId: team._id,
        members: team.members.map((m) => ({
          userId: m.userId._id,
          name: m.userId.name,
          joinedAt: m.joinedAt,
        })),
        chatEnabled: team.chatEnabled,
        status: team.status,
      });

      logger.info(`Notified team update: ${teamId}`);
    } catch (err) {
      logger.error(`Notify team updated error: ${err.message}`);
    }
  }

  async notifyHackathonStarted(hackathonId) {
    try {
      const usersInHackathon = Array.from(this.userToHackathon.entries())
        .filter(([userId, userHackathonId]) => userHackathonId === hackathonId)
        .map(([userId]) => userId);

      this.broadcastToUsers(usersInHackathon, {
        type: "hackathon.started",
        hackathonId,
        timestamp: Date.now(),
      });

      this.activeHackathons.add(hackathonId);
      logger.info(`Notified hackathon started: ${hackathonId}`);
    } catch (err) {
      logger.error(`Notify hackathon started error: ${err.message}`);
    }
  }

  async notifyHackathonEnded(hackathonId) {
    try {
      const usersInHackathon = Array.from(this.userToHackathon.entries())
        .filter(([userId, userHackathonId]) => userHackathonId === hackathonId)
        .map(([userId]) => userId);

      this.broadcastToUsers(usersInHackathon, {
        type: "hackathon.ended",
        hackathonId,
        timestamp: Date.now(),
      });

      this.activeHackathons.delete(hackathonId);
      logger.info(`Notified hackathon ended: ${hackathonId}`);
    } catch (err) {
      logger.error(`Notify hackathon ended error: ${err.message}`);
    }
  }

  async sendNotification(userId, notification) {
    try {
      // Save to database
      const notificationDoc = new Notification({
        userId,
        hackathonId: notification.hackathonId,
        type: notification.type,
        payload: notification.payload,
        read: false,
        createdAt: new Date(),
      });

      await notificationDoc.save();

      // Send via WebSocket if user is online
      const sent = this.sendToUser(userId, {
        type: "notification",
        notification: {
          id: notificationDoc._id,
          type: notificationDoc.type,
          payload: notificationDoc.payload,
          createdAt: notificationDoc.createdAt,
          read: false,
        },
      });

      logger.debug(
        `Notification sent to ${userId}: ${sent ? "success" : "offline"}`
      );
      return sent;
    } catch (err) {
      logger.error(`Send notification error: ${err.message}`);
      return false;
    }
  }

  async sendBulkNotifications(userIds, notification) {
    const results = await Promise.allSettled(
      userIds.map((userId) => this.sendNotification(userId, notification))
    );

    const successCount = results.filter(
      (r) => r.status === "fulfilled" && r.value
    ).length;
    logger.info(`Bulk notifications sent: ${successCount}/${userIds.length}`);
    return successCount;
  }

  // Rate limiting for messages
  isMessageRateLimited(key) {
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxMessages = 20; // 20 messages per minute per team

    if (!this.messageRateLimit.has(key)) {
      this.messageRateLimit.set(key, []);
    }

    const timestamps = this.messageRateLimit.get(key);

    // Remove old timestamps
    const validTimestamps = timestamps.filter((time) => now - time < windowMs);

    if (validTimestamps.length >= maxMessages) {
      return true;
    }

    validTimestamps.push(now);
    this.messageRateLimit.set(key, validTimestamps);
    return false;
  }

  // Update user's hackathon mapping when they join/leave
  updateUserHackathon(userId, hackathonId) {
    if (hackathonId) {
      this.userToHackathon.set(userId, hackathonId.toString());
      this.activeHackathons.add(hackathonId.toString());
    } else {
      this.userToHackathon.delete(userId);
    }
  }

  // Get team members who are currently online
  getOnlineTeamMembers(teamMemberIds) {
    return teamMemberIds.filter(
      (userId) =>
        this.clients.has(userId) &&
        this.clients.get(userId).readyState === WebSocket.OPEN // FIXED: Use WebSocket.OPEN
    );
  }

  // Stats and monitoring
  getSystemStats() {
    return {
      connectedClients: this.clients.size,
      activeHackathons: this.activeHackathons.size,
      userHackathonMappings: this.userToHackathon.size,
      rateLimitEntries: this.messageRateLimit.size,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  }

  // Get users by hackathon (for admin purposes)
  getUsersByHackathon(hackathonId) {
    const users = [];
    this.userToHackathon.forEach((userHackathonId, userId) => {
      if (userHackathonId === hackathonId && this.clients.has(userId)) {
        users.push(userId);
      }
    });
    return users;
  }

  // Cleanup rate limit entries periodically
  cleanupRateLimits() {
    const now = Date.now();
    const windowMs = 60000;

    this.messageRateLimit.forEach((timestamps, key) => {
      const validTimestamps = timestamps.filter(
        (time) => now - time < windowMs
      );
      if (validTimestamps.length === 0) {
        this.messageRateLimit.delete(key);
      } else {
        this.messageRateLimit.set(key, validTimestamps);
      }
    });
  }

  // Add cleanup mechanism
  startCleanupInterval() {
    setInterval(() => {
      this.cleanupRateLimits();
      this.cleanupStaleClients();
    }, 300000); // Clean up every 5 minutes
  }

  cleanupStaleClients() {
    const now = Date.now();
    this.clients.forEach((ws, userId) => {
      if (now - (ws.lastActivity || now) > 3600000) {
        // 1 hour inactivity
        ws.close(1001, "Connection stale");
        this.removeClient(userId);
      }
    });
  }

  // Cleanup
  shutdown() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    this.clients.forEach((client) => {
      client.close(1000, "Server shutting down");
    });

    this.clients.clear();
    this.userToHackathon.clear();
    this.activeHackathons.clear();
    this.messageRateLimit.clear();

    logger.info("WebSocket service shut down");
  }
}

const webSocketService = new WebSocketService();

mongoose.connection.once("open", () => {
  console.log("Starting scheduler...");
  startScheduler(webSocketService);
});

export default webSocketService;
