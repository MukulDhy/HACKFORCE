const express = require("express");
const router = express.Router();
const {
  createMessage,
  getTeamMessages,
  getMessageById,
  updateMessage,
  deleteMessage,
  markMessageAsRead,
  getUnreadMessagesCount,
  searchMessages,
} = require("../controllers/message.controller");

// @route   POST /api/messages
// @desc    Create a new message
// @access  Private
router.post("/", createMessage);

// @route   GET /api/messages/team/:teamId
// @desc    Get all messages for a specific team with pagination
// @access  Private
// Query params: page, limit
router.get("/team/:teamId", getTeamMessages);

// @route   GET /api/messages/search/:teamId
// @desc    Search messages in a team
// @access  Private
// Query params: query, page, limit
router.get("/search/:teamId", searchMessages);

// @route   GET /api/messages/unread/:teamId/:userId
// @desc    Get unread messages count for a user in a team
// @access  Private
router.get("/unread/:teamId/:userId", getUnreadMessagesCount);

// @route   GET /api/messages/:messageId
// @desc    Get a specific message by ID
// @access  Private
router.get("/:messageId", getMessageById);

// @route   PUT /api/messages/:messageId
// @desc    Update a message
// @access  Private
router.put("/:messageId", updateMessage);

// @route   DELETE /api/messages/:messageId
// @desc    Delete a message
// @access  Private
router.delete("/:messageId", deleteMessage);

// @route   POST /api/messages/:messageId/read
// @desc    Mark message as read by a user
// @access  Private
router.post("/:messageId/read", markMessageAsRead);

module.exports = router;
