const mongoose = require("mongoose");
const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    messageType: {
      type: String,
      enum: ["text", "file", "system"],
      default: "text",
    },
    fileUrl: {
      type: String,
      trim: true,
    },
    fileName: {
      type: String,
      trim: true,
    },
    readBy: [
      {
        userId: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
    collection: "messages",
  }
);

// Indexes for better query performance
messageSchema.index({ teamId: 1, createdAt: 1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ createdAt: -1 });

// Static method to get messages for a team with pagination
messageSchema.statics.getTeamMessages = function (
  teamId,
  page = 1,
  limit = 50
) {
  const skip = (page - 1) * limit;

  return this.find({ teamId })
    .populate("senderId", "name profilePicture")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

// Instance method to mark message as read by a user
messageSchema.methods.markAsRead = function (userId) {
  const existingRead = this.readBy.find(
    (read) => read.userId.toString() === userId.toString()
  );

  if (!existingRead) {
    this.readBy.push({
      userId: userId,
      readAt: new Date(),
    });

    return this.save();
  }

  return Promise.resolve(this);
};

// Virtual for checking if message is read by a specific user
messageSchema.virtual("isRead").get(function () {
  return (userId) => {
    return this.readBy.some(
      (read) => read.userId.toString() === userId.toString()
    );
  };
});

module.exports = mongoose.model("Message", messageSchema);
