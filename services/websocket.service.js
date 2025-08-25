const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");
const config = require("../config/config");
const User = require("../models/user.model");

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Connected web clients
    this.heartbeatInterval = 30000; // 30 seconds
    this.pingInterval = null;
  }

  initialize(server) {
    this.wss = new WebSocket.Server({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      this.handleUpgrade(request, socket, head).catch((err) => {
        logger.error(`Upgrade failed: ${err.message}`);
        socket.destroy();
      });
    });

    this.setupEventHandlers();
    logger.info("WebSocket server initialized");
  }

  async handleUpgrade(request, socket, head) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

      // Handle web client authentication
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
        jwt.verify(token, config.jwt.secret, (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        });
      });

      if (!decoded?.id) {
        return { error: "Invalid token payload" };
      }

      const user = await User.findById(decoded.id);
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
      const url = new URL(request.url, `http://${request.headers.host}`);

      // Handle web client connection
      const userId = request.user?.id;
      if (!userId) {
        return ws.close(1008, "Authentication failed");
      }

      this.handleClientConnection(ws, userId);
    });

    this.startHeartbeat();
  }

  handleClientConnection(ws, userId) {
    logger.info(`Client connected: ${userId}`);

    this.addClient(userId, ws);

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
  }

  handleClientMessage(ws, userId, data) {
    try {
      const message = JSON.parse(data);
      logger.debug(`Client ${userId} message: ${message.type}`);

      switch (message.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          break;
        case "get-esp32-status":
          this.sendToUser(userId, {
            type: "esp32-status-response",
            status: this.esp32Status,
          });
          break;
        case "get-sensor-data":
          this.handleGetSensorData(userId, message);
          break;
        case "control-esp32":
          this.handleControlESP32(userId, message);
          break;
        default:
          logger.debug(`Unhandled client message type: ${message.type}`);
      }
    } catch (err) {
      logger.error(`Client message handling error: ${err.message}`);
    }
  }

  startHeartbeat() {
    this.pingInterval = setInterval(() => {
      // Ping web clients
      this.clients.forEach((ws, userId) => {
        if (ws.isAlive === false) {
          logger.warn(`Terminating unresponsive client: ${userId}`);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, this.heartbeatInterval);
  }

  sendToUser(userId, data) {
    const client = this.clients.get(userId);
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

  broadcastToClients(data) {
    let successCount = 0;
    this.clients.forEach((client, userId) => {
      if (this.sendToUser(userId, data)) {
        successCount++;
      }
    });

    if (successCount > 0) {
      logger.debug(`Broadcasted to ${successCount} clients`);
    }

    return successCount;
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
      logger.info(
        `Client ${userId} disconnected (${this.clients.size} remaining)`
      );
    }
  }

  // Stats and monitoring
  getSystemStats() {
    return {
      connectedClients: this.clients.size,
      esp32Status: this.esp32Status,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  }
  // Cleanup
  shutdown() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }
    this.clients.forEach((client) => {
      client.close();
    });

    logger.info("WebSocket service shut down");
  }
}

module.exports = new WebSocketService();
