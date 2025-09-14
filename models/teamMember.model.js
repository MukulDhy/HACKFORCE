import mongoose from "mongoose";
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
    // Additional fields for hackathon
    contributions: {
      type: String,
      trim: true,
      maxLength: 500,
    },
    skills: [
      {
        type: String,
        trim: true,
      },
    ],
    isPresent: {
      type: Boolean,
      default: true,
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

// Virtual for getting user details
teamMemberSchema.virtual("user", {
  ref: "User",
  localField: "userId",
  foreignField: "_id",
  justOne: true,
});

// Virtual for getting team details
teamMemberSchema.virtual("team", {
  ref: "Team",
  localField: "teamId",
  foreignField: "_id",
  justOne: true,
});

// Ensure virtual fields are serialized
teamMemberSchema.set("toJSON", { virtuals: true });
teamMemberSchema.set("toObject", { virtuals: true });

const TeamMember = mongoose.model("TeamMember", teamMemberSchema);

export default TeamMember;
