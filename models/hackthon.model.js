import mongoose from "mongoose";
import AutoIncrementFactory from "mongoose-sequence";
const { Schema } = mongoose;

// Hackathon Schema
const hackathonSchema = new Schema(
  {
    hackathonId: {
      type: Number,
      unique: true,
      index: true,
    },
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
    winnerAnnouncementDate: {
      type: Date,
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
          default: 0,
        },
        rewards: String,
      },
    ],
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    totalMembersJoined: {
      type: Number,
      default: 0,
    },
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

    // ✅ Newly added fields (all optional)
    evaluationCriteria: [
      {
        criterion: { type: String },
        weight: { type: Number },
      },
    ],
    submissionDeadline: {
      type: Date,
    },
    submissionFormat: {
      type: String, // e.g., GitHub repo, PPT, video
    },
    organizer: {
      name: { type: String },
      contactEmail: { type: String },
      contactNumber: { type: String },
      organization: { type: String },
    },
    faqs: [
      {
        question: { type: String },
        answer: { type: String },
      },
    ],
    socialLinks: {
      website: { type: String },
      linkedin: { type: String },
      twitter: { type: String },
      discord: { type: String },
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    ],
    status: {
      type: String,
      enum: [
        "upcoming",
        "registration_open",
        "registration_closed",
        "ongoing",
        "winner_to_announced",
        "completed",
        "cancelled",
      ],
      default: "registration_open",
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

// Auto-increment hackathonId starting from 100
const AutoIncrement = AutoIncrementFactory(mongoose);
hackathonSchema.plugin(AutoIncrement, {
  inc_field: "hackathonId",
  start_seq: 100,
});

// Indexes
hackathonSchema.index({ startDate: 1 });
hackathonSchema.index({ registrationDeadline: 1 });
hackathonSchema.index({ isActive: 1 });
hackathonSchema.index({ status: 1 });
hackathonSchema.index({ tags: 1 });

const Hackathon = mongoose.model("Hackathon", hackathonSchema);
export default Hackathon;
