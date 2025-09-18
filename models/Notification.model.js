import mongoose from "mongoose";
const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "team_invite",
        "team_join",
        "team_leave",
        "hackathon_start",
        "hackathon_end",
        "submission_reminder",
        "announcement",
        "message",
        "system",
      ],
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    hackathonId: {
      type: Schema.Types.ObjectId,
      ref: "Hackathon",
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
    },
    relatedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    read: {
      type: Boolean,
      default: false,
    },
    actionUrl: {
      type: String,
      trim: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: "notifications",
  }
);

// Indexes for better query performance
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
notificationSchema.index({ type: 1 });

// Static method to get user notifications with pagination
notificationSchema.statics.getUserNotifications = function (
  userId,
  page = 1,
  limit = 20,
  unreadOnly = false
) {
  const skip = (page - 1) * limit;
  const query = { userId };

  if (unreadOnly) {
    query.read = false;
  }

  return this.find(query)
    .populate("hackathonId", "title")
    .populate("teamId", "name")
    .populate("relatedUserId", "name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

// Static method to mark multiple notifications as read
notificationSchema.statics.markAsRead = function (notificationIds, userId) {
  return this.updateMany(
    {
      _id: { $in: notificationIds },
      userId: userId,
    },
    {
      $set: { read: true },
    }
  );
};

// Static method to create a notification
notificationSchema.statics.createNotification = function (data) {
  return this.create(data);
};

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
