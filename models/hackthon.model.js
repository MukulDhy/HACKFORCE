import mongoose from "mongoose";
const { Schema } = mongoose;

// Hackathon Schema
const hackathonSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxLength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    registrationDeadline: {
      type: Date,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    problemStatements: [
      {
        type: String,
        required: true,
        trim: true,
      },
    ],
    maxTeamSize: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
    venue: {
      type: String,
      trim: true,
    },
    mode: {
      type: String,
      enum: ["online", "offline", "hybrid"],
      default: "offline",
    },
    registrationFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    prizes: [
      {
        position: {
          type: String,
          required: true, // e.g., "1st", "2nd", "3rd", "Best Innovation"
        },
        amount: {
          type: Number,
          required: true,
        },
        description: String,
      },
    ],
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    maxRegistrations: {
      type: Number,
      min: 1,
    },
    requirements: [
      {
        type: String,
        trim: true,
      },
    ],
    rules: [
      {
        type: String,
        trim: true,
      },
    ],
    bannerImage: {
      type: String, // URL to banner image
      trim: true,
    },
    waD: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "upcoming",
        "registration_open",
        "registration_closed",
        "ongoing",
        "winnertoannouced",
        "completed",
        "cancelled",
      ],
      default: "upcoming",
    },
    reason: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    collection: "hackathons",
  }
);

// Indexes
hackathonSchema.index({ startDate: 1 });
hackathonSchema.index({ registrationDeadline: 1 });
hackathonSchema.index({ isActive: 1 });
hackathonSchema.index({ status: 1 });
hackathonSchema.index({ tags: 1 });

const Hackathon = mongoose.model("Hackathon", hackathonSchema);
export default Hackathon;
