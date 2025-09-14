import cron from "node-cron";
import mongoose from "mongoose";
import { sendTeamNotification } from "./emailService.js";
import Hackathon from "./models/Hackathon.js";
import Team from "./models/Team.js";
import TeamMember from "./models/TeamMember.js";
import User from "./models/User.js";

// Scheduler function
export const startScheduler = (io) => {
  // Run every minute
  cron.schedule("* * * * *", async () => {
    try {
      console.log("Running team formation scheduler...");
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60000);

      // Find hackathons with deadline passed in the last 1 min
      const hackathons = await Hackathon.find({
        registrationDeadline: {
          $lte: now,
          $gte: oneMinuteAgo,
        },
        isActive: true,
        status: "registration_open",
        "participants.0": { $exists: true }, // has participants
      }).populate({
        path: "participants",
        select: "name email skills",
      });

      console.log(
        `Found ${hackathons.length} hackathons ready for team formation`
      );

      for (const hackathon of hackathons) {
        await createTeamsForHackathon(hackathon, io);
      }
    } catch (error) {
      console.error("Scheduler error:", error);
    }
  });

  console.log("Team formation scheduler started");
};

// Team creation logic
const createTeamsForHackathon = async (hackathon, io) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { participants, maxTeamSize, problemStatements, title, _id } =
      hackathon;

    if (!participants || !participants.length) {
      console.log(`No participants for hackathon: ${title}`);
      await session.abortTransaction();
      session.endSession();
      return;
    }

    if (!problemStatements || !problemStatements.length) {
      console.log(`No problem statements for hackathon: ${title}`);
      await session.abortTransaction();
      session.endSession();
      return;
    }

    // Shuffle participants randomly using Fisher-Yates algorithm
    const shuffledParticipants = [...participants];
    for (let i = shuffledParticipants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledParticipants[i], shuffledParticipants[j]] = [
        shuffledParticipants[j],
        shuffledParticipants[i],
      ];
    }

    const createdTeams = [];
    const emailPromises = [];

    // Split participants into teams
    for (let i = 0; i < shuffledParticipants.length; i += maxTeamSize) {
      const teamMembers = shuffledParticipants.slice(i, i + maxTeamSize);

      // Pick random problem
      const randomProblemIndex = Math.floor(
        Math.random() * problemStatements.length
      );
      const randomProblem = problemStatements[randomProblemIndex];

      // Generate team name
      const teamName = `Team-${Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()}`;

      // Create team document
      const team = await Team.create(
        [
          {
            hackathonId: _id,
            name: teamName,
            problemStatement: randomProblem,
            submissionStatus: "not_submitted",
          },
        ],
        { session }
      );

      // Create team members
      const teamMemberPromises = [];
      for (const [index, member] of teamMembers.entries()) {
        // First member is the team leader
        const role = index === 0 ? "leader" : "developer";

        teamMemberPromises.push(
          TeamMember.create(
            [
              {
                teamId: team[0]._id,
                userId: member._id,
                role: role,
                status: "active",
              },
            ],
            { session }
          )
        );
      }

      await Promise.all(teamMemberPromises);

      // Populate team with member details
      const populatedTeam = await Team.findById(team[0]._id)
        .populate({
          path: "members",
          populate: {
            path: "userId",
            select: "id name email skills",
          },
        })
        .session(session);

      createdTeams.push(populatedTeam);

      // Prepare email notifications
      for (const member of teamMembers) {
        const teammates = teamMembers
          .filter((m) => m._id.toString() !== member._id.toString())
          .map((m) => m.name);

        emailPromises.push(
          sendTeamNotification({
            email: member.email,
            name: member.name,
            hackathonTitle: title,
            teammates,
            problemStatement: randomProblem,
            teamName: teamName,
          })
        );
      }
    }

    // Update hackathon status to registration_closed
    await Hackathon.findByIdAndUpdate(
      _id,
      {
        $set: {
          status: "registration_closed",
          teamsFormed: true,
        },
      },
      { session }
    );

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    // Send all emails (outside transaction)
    await Promise.allSettled(emailPromises);

    // Notify all connected clients
    io.to(_id.toString()).emit("teams-formed", {
      hackathonId: _id,
      teams: createdTeams,
    });

    console.log(`Created ${createdTeams.length} teams for ${title}`);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error creating teams for hackathon:", error);
    throw error;
  }
};
