import cron from "node-cron";
import mongoose from "mongoose";
import { sendTeamNotification } from "./emailService.js";

// Example Mongoose Models
import Hackathon from "./models/Hackathon.js";
import Team from "./models/Team.js";

// Scheduler function
export const startScheduler = (io) => {
  // Run every minute
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();

      // Find hackathons with deadline passed in the last 1 min
      const hackathons = await Hackathon.find({
        registrationDeadline: {
          $lte: now,
          $gte: new Date(now.getTime() - 60000),
        },
        isActive: true,
        "teams.0": { $exists: false }, // no teams yet
      }).populate({
        path: "registrations",
        populate: { path: "user" },
      });

      for (const hackathon of hackathons) {
        await createTeamsForHackathon(hackathon, io);
      }
    } catch (error) {
      console.error("Scheduler error:", error);
    }
  });
};

// Team creation logic
const createTeamsForHackathon = async (hackathon, io) => {
  try {
    const { registrations, maxTeamSize, problemStatements } = hackathon;

    if (!registrations.length) {
      console.log(`No registrations for hackathon: ${hackathon.title}`);
      return;
    }

    // Shuffle users randomly
    const shuffledUsers = registrations
      .map((reg) => reg.user)
      .sort(() => Math.random() - 0.5);

    const createdTeams = [];

    // Split users into teams
    for (let i = 0; i < shuffledUsers.length; i += maxTeamSize) {
      const teamMembers = shuffledUsers.slice(i, i + maxTeamSize);

      // Pick random problem
      const randomProblem =
        problemStatements[Math.floor(Math.random() * problemStatements.length)];

      // Create team document
      const team = await Team.create({
        hackathonId: hackathon._id,
        problemStatement: randomProblem,
        members: teamMembers.map((user) => ({ userId: user._id })),
      });

      // Populate members with user info
      await team.populate({
        path: "members.userId",
        select: "id name email skills",
      });

      createdTeams.push(team);

      // Send emails
      for (const member of team.members) {
        const teammates = team.members
          .filter(
            (m) => m.userId._id.toString() !== member.userId._id.toString()
          )
          .map((m) => m.userId.name);

        await sendTeamNotification({
          email: member.userId.email,
          name: member.userId.name,
          hackathonTitle: hackathon.title,
          teammates,
          problemStatement: randomProblem,
        });
      }
    }

    // Notify all connected clients
    io.to(hackathon._id.toString()).emit("teams-formed", {
      hackathonId: hackathon._id,
      teams: createdTeams,
    });

    console.log(`Created ${createdTeams.length} teams for ${hackathon.title}`);
  } catch (error) {
    console.error("Error creating teams:", error);
  }
};
