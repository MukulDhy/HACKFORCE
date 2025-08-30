const mongoose = require("mongoose");
const { Schema } = mongoose;

// Team Member Schema
const teamMemberSchema = new Schema(
  {
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: [
        "leader",
        "developer",
        "designer",
        "data_scientist",
        "business_analyst",
        "other",
      ],
      default: "developer",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["active", "left", "removed"],
      default: "active",
    },
  },
  {
    timestamps: true,
    collection: "team_members",
  }
);

// Compound unique index
teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });
teamMemberSchema.index({ teamId: 1 });
teamMemberSchema.index({ userId: 1 });
teamMemberSchema.index({ status: 1 });

const TeamMember = mongoose.model("TeamMember", teamMemberSchema);

export default TeamMember;
