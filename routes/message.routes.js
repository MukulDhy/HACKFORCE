const express = require("express");
const router = express.Router();
const Message = require("../models/message.model");
const Team = require("../models/team.model");
const { authenticate, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validation");
const logger = require("../utils/logger");

// Get messages for a team
router.get("/team/:teamId/messages", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Check if user is member of the team
    const team = await Team.findOne({
      _id: teamId,
      "members.userId": req.user.id,
    });

    if (!team) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this team.",
      });
    }

    const messages = await Message.getTeamMessages(
      teamId,
      parseInt(page),
      parseInt(limit)
    );

    res.json({
      success: true,
      data: messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: await Message.countDocuments({ teamId }),
      },
    });
  } catch (error) {
    logger.error("Get messages error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch messages",
    });
  }
});

// Send a message
router.post("/team/:teamId/messages", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { text, messageType = "text", fileUrl, fileName } = req.body;

    // Validate required fields
    if (!text && messageType === "text") {
      return res.status(400).json({
        success: false,
        message: "Message text is required",
      });
    }

    // Check if user is member of the team
    const team = await Team.findOne({
      _id: teamId,
      "members.userId": req.user.id,
      "members.status": "active",
    });

    if (!team) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not an active member of this team.",
      });
    }

    // Check if team chat is enabled
    if (!team.chatEnabled) {
      return res.status(403).json({
        success: false,
        message: "Chat is disabled for this team",
      });
    }

    // Create message
    const message = new Message({
      teamId,
      senderId: req.user.id,
      text: text?.trim(),
      messageType,
      fileUrl,
      fileName,
    });

    await message.save();
    await message.populate("senderId", "name profilePicture");

    // Emit WebSocket event for real-time updates
    req.app.get("websocket").broadcastToTeam(teamId, {
      type: "message.new",
      message: message.toObject(),
    });

    res.status(201).json({
      success: true,
      data: message,
    });
  } catch (error) {
    logger.error("Send message error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send message",
    });
  }
});

// Mark message as read
router.patch("/messages/:messageId/read", authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    // Check if user is member of the team
    const team = await Team.findOne({
      _id: message.teamId,
      "members.userId": req.user.id,
    });

    if (!team) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this team.",
      });
    }

    await message.markAsRead(req.user.id);

    res.json({
      success: true,
      data: message,
    });
  } catch (error) {
    logger.error("Mark message as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark message as read",
    });
  }
});

// Delete a message (only for sender or team admin)
router.delete("/messages/:messageId", authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    // Check if user is sender or team admin
    const team = await Team.findOne({
      _id: message.teamId,
      $or: [
        { "members.userId": req.user.id, "members.role": "leader" },
        { "members.userId": req.user.id, "members.isAdmin": true },
      ],
    });

    const isSender = message.senderId.toString() === req.user.id;

    if (!team && !isSender) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Only message sender or team admin can delete messages.",
      });
    }

    await Message.findByIdAndDelete(messageId);

    // Emit WebSocket event for real-time updates
    req.app.get("websocket").broadcastToTeam(message.teamId, {
      type: "message.deleted",
      messageId,
    });

    res.json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    logger.error("Delete message error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete message",
    });
  }
});

// Get unread message count for a team
router.get(
  "/team/:teamId/messages/unread-count",
  authenticate,
  async (req, res) => {
    try {
      const { teamId } = req.params;

      // Check if user is member of the team
      const team = await Team.findOne({
        _id: teamId,
        "members.userId": req.user.id,
      });

      if (!team) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You are not a member of this team.",
        });
      }

      const unreadCount = await Message.countDocuments({
        teamId,
        readBy: { $not: { $elemMatch: { userId: req.user.id } } },
        senderId: { $ne: req.user.id }, // Don't count user's own messages
      });

      res.json({
        success: true,
        data: { unreadCount },
      });
    } catch (error) {
      logger.error("Get unread count error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get unread message count",
      });
    }
  }
);

module.exports = router;
