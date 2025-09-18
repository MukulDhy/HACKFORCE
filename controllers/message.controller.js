const Message = require("../models/message.model");
const mongoose = require("mongoose");

// Create a new message
const createMessage = async (req, res) => {
  try {
    const { teamId, senderId, text, messageType, fileUrl, fileName } = req.body;

    // Validate required fields
    if (!teamId || !senderId || !text) {
      return res.status(400).json({
        success: false,
        message: "TeamId, senderId, and text are required",
      });
    }

    // Validate ObjectIds
    if (
      !mongoose.Types.ObjectId.isValid(teamId) ||
      !mongoose.Types.ObjectId.isValid(senderId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid teamId or senderId format",
      });
    }

    const messageData = {
      teamId,
      senderId,
      text,
      messageType: messageType || "text",
    };

    // Add file data if provided
    if (fileUrl) messageData.fileUrl = fileUrl;
    if (fileName) messageData.fileName = fileName;

    const message = new Message(messageData);
    await message.save();

    // Populate sender information
    await message.populate("senderId", "name profilePicture");

    res.status(201).json({
      success: true,
      message: "Message created successfully",
      data: message,
    });
  } catch (error) {
    console.error("Error creating message:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get all messages for a team with pagination
const getTeamMessages = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Validate teamId
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid teamId format",
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Validate pagination parameters
    if (pageNum < 1 || limitNum < 1) {
      return res.status(400).json({
        success: false,
        message: "Page and limit must be positive numbers",
      });
    }

    const messages = await Message.getTeamMessages(teamId, pageNum, limitNum);

    // Get total count for pagination info
    const totalMessages = await Message.countDocuments({ teamId });
    const totalPages = Math.ceil(totalMessages / limitNum);

    res.status(200).json({
      success: true,
      data: {
        messages: messages.reverse(), // Reverse to show oldest first
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalMessages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching team messages:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get a specific message by ID
const getMessageById = async (req, res) => {
  try {
    const { messageId } = req.params;

    // Validate messageId
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid messageId format",
      });
    }

    const message = await Message.findById(messageId)
      .populate("senderId", "name profilePicture")
      .populate("readBy.userId", "name profilePicture");

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    res.status(200).json({
      success: true,
      data: message,
    });
  } catch (error) {
    console.error("Error fetching message:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Update a message
const updateMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text, messageType, fileUrl, fileName } = req.body;

    // Validate messageId
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid messageId format",
      });
    }

    const updateData = {};
    if (text !== undefined) updateData.text = text;
    if (messageType !== undefined) updateData.messageType = messageType;
    if (fileUrl !== undefined) updateData.fileUrl = fileUrl;
    if (fileName !== undefined) updateData.fileName = fileName;

    const message = await Message.findByIdAndUpdate(messageId, updateData, {
      new: true,
      runValidators: true,
    }).populate("senderId", "name profilePicture");

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Message updated successfully",
      data: message,
    });
  } catch (error) {
    console.error("Error updating message:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete a message
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    // Validate messageId
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid messageId format",
      });
    }

    const message = await Message.findByIdAndDelete(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Mark message as read by a user
const markMessageAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;

    // Validate IDs
    if (
      !mongoose.Types.ObjectId.isValid(messageId) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid messageId or userId format",
      });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    await message.markAsRead(userId);

    res.status(200).json({
      success: true,
      message: "Message marked as read successfully",
    });
  } catch (error) {
    console.error("Error marking message as read:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get unread messages count for a user in a team
const getUnreadMessagesCount = async (req, res) => {
  try {
    const { teamId, userId } = req.params;

    // Validate IDs
    if (
      !mongoose.Types.ObjectId.isValid(teamId) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid teamId or userId format",
      });
    }

    const unreadCount = await Message.countDocuments({
      teamId,
      senderId: { $ne: userId }, // Exclude messages sent by the user
      "readBy.userId": { $ne: userId }, // Messages not read by the user
    });

    res.status(200).json({
      success: true,
      data: {
        unreadCount,
      },
    });
  } catch (error) {
    console.error("Error getting unread messages count:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Search messages in a team
const searchMessages = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { query, page = 1, limit = 20 } = req.query;

    // Validate teamId
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid teamId format",
      });
    }

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const searchRegex = new RegExp(query.trim(), "i");

    const messages = await Message.find({
      teamId,
      text: { $regex: searchRegex },
    })
      .populate("senderId", "name profilePicture")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const totalResults = await Message.countDocuments({
      teamId,
      text: { $regex: searchRegex },
    });

    res.status(200).json({
      success: true,
      data: {
        messages,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(totalResults / limitNum),
          totalResults,
          hasNextPage: pageNum < Math.ceil(totalResults / limitNum),
          hasPrevPage: pageNum > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error searching messages:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  createMessage,
  getTeamMessages,
  getMessageById,
  updateMessage,
  deleteMessage,
  markMessageAsRead,
  getUnreadMessagesCount,
  searchMessages,
};
