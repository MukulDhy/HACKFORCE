const express = require("express");
const router = express.Router();
const Notification = require("../models/notification.model");
const { authenticate } = require("../middleware/auth");
const logger = require("../utils/logger");

// Get user notifications
router.get("/notifications", authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const notifications = await Notification.getUserNotifications(
      req.user.id,
      parseInt(page),
      parseInt(limit),
      unreadOnly === "true"
    );

    const totalCount = await Notification.countDocuments({
      userId: req.user.id,
    });
    const unreadCount = await Notification.countDocuments({
      userId: req.user.id,
      read: false,
    });

    res.json({
      success: true,
      data: notifications,
      counts: {
        total: totalCount,
        unread: unreadCount,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
      },
    });
  } catch (error) {
    logger.error("Get notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
});

// Mark notifications as read
router.patch("/notifications/read", authenticate, async (req, res) => {
  try {
    const { notificationIds } = req.body;

    if (!notificationIds || !Array.isArray(notificationIds)) {
      return res.status(400).json({
        success: false,
        message: "notificationIds array is required",
      });
    }

    await Notification.markAsRead(notificationIds, req.user.id);

    // Emit WebSocket event for real-time updates
    req.app.get("websocket").sendToUser(req.user.id, {
      type: "notifications.marked_read",
      notificationIds,
    });

    res.json({
      success: true,
      message: "Notifications marked as read",
    });
  } catch (error) {
    logger.error("Mark notifications as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
    });
  }
});

// Mark all notifications as read
router.patch("/notifications/read-all", authenticate, async (req, res) => {
  try {
    const unreadNotifications = await Notification.find({
      userId: req.user.id,
      read: false,
    });

    const notificationIds = unreadNotifications.map((n) => n._id);

    await Notification.updateMany(
      { userId: req.user.id, read: false },
      { $set: { read: true } }
    );

    // Emit WebSocket event for real-time updates
    req.app.get("websocket").sendToUser(req.user.id, {
      type: "notifications.marked_read",
      notificationIds,
    });

    res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    logger.error("Mark all notifications as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark all notifications as read",
    });
  }
});

// Delete a notification
router.delete(
  "/notifications/:notificationId",
  authenticate,
  async (req, res) => {
    try {
      const { notificationId } = req.params;

      const notification = await Notification.findOne({
        _id: notificationId,
        userId: req.user.id,
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification not found",
        });
      }

      await Notification.findByIdAndDelete(notificationId);

      res.json({
        success: true,
        message: "Notification deleted successfully",
      });
    } catch (error) {
      logger.error("Delete notification error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete notification",
      });
    }
  }
);

// Delete all notifications
router.delete("/notifications", authenticate, async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user.id });

    res.json({
      success: true,
      message: "All notifications deleted successfully",
    });
  } catch (error) {
    logger.error("Delete all notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete all notifications",
    });
  }
});

// Get notification preferences (you'll need to create a UserPreferences model)
router.get("/notifications/preferences", authenticate, async (req, res) => {
  try {
    // This would fetch from a UserPreferences model
    // For now, returning default preferences
    const defaultPreferences = {
      email: {
        teamInvites: true,
        hackathonUpdates: true,
        announcements: true,
        messages: false,
      },
      push: {
        teamInvites: true,
        hackathonUpdates: true,
        announcements: true,
        messages: true,
      },
      inApp: {
        teamInvites: true,
        hackathonUpdates: true,
        announcements: true,
        messages: true,
      },
    };

    res.json({
      success: true,
      data: defaultPreferences,
    });
  } catch (error) {
    logger.error("Get notification preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get notification preferences",
    });
  }
});

// Update notification preferences
router.patch("/notifications/preferences", authenticate, async (req, res) => {
  try {
    const { preferences } = req.body;

    // This would update a UserPreferences model
    // For now, just returning success

    res.json({
      success: true,
      message: "Notification preferences updated successfully",
    });
  } catch (error) {
    logger.error("Update notification preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update notification preferences",
    });
  }
});

// Create a test notification (for development only)
if (process.env.NODE_ENV === "development") {
  router.post("/notifications/test", authenticate, async (req, res) => {
    try {
      const { type = "system", title, message } = req.body;

      const notification = await Notification.createNotification({
        userId: req.user.id,
        type,
        title: title || "Test Notification",
        message: message || "This is a test notification",
        priority: "medium",
      });

      // Emit WebSocket event for real-time updates
      req.app.get("websocket").sendToUser(req.user.id, {
        type: "notification.new",
        notification,
      });

      res.status(201).json({
        success: true,
        data: notification,
      });
    } catch (error) {
      logger.error("Create test notification error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create test notification",
      });
    }
  });
}

module.exports = router;
