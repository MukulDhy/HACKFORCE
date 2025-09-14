import cron from "node-cron";
import mongoose from "mongoose";
import { sendTeamNotification } from "../services/sendTeamEmail.service.js";
import Hackathon from "../models/hackthon.model.js";
import Team from "../models/team.model.js";
import TeamMember from "../models/teamMember.model.js";
import User from "../models/user.model.js";
import logger from "./logger.js";

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
        // Check if there are enough participants
        // if (hackathon.participants.length < hackathon.minTeamSize) {
        //   logger.warn("Not enough participants found for the hackathon.");
        //   hackathon.status = "cancelled";
        //   await hackathon.save();
        //   continue;
        // }
        await createTeamsForHackathon(hackathon, io);
      }
    } catch (error) {
      console.error("Scheduler error:", error);
      logger.error("Scheduler error:", error);
    }
  });

  console.log("Team formation scheduler started");
};

// Team creation logic
const createTeamsForHackathon = async (hackathon, io) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      participants,
      maxTeamSize,
      minTeamSize,
      problemStatements,
      title,
      _id,
    } = hackathon;

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

    // Calculate optimal team distribution
    const totalParticipants = participants.length;
    const optimalTeamCount = Math.ceil(totalParticipants / maxTeamSize);
    const baseTeamSize = Math.floor(totalParticipants / optimalTeamCount);
    const remainder = totalParticipants % optimalTeamCount;

    console.log(
      `Participants: ${totalParticipants}, Min team size: ${minTeamSize}, Max team size: ${maxTeamSize}`
    );
    console.log(
      `Creating ${optimalTeamCount} teams with base size ${baseTeamSize} and ${remainder} extra members`
    );

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
    let participantIndex = 0;

    // Create teams with optimal distribution
    for (let teamIndex = 0; teamIndex < optimalTeamCount; teamIndex++) {
      // Determine team size (add extra members to first few teams)
      const currentTeamSize =
        teamIndex < remainder ? baseTeamSize + 1 : baseTeamSize;

      // Ensure team meets minimum size requirement
      if (currentTeamSize < minTeamSize) {
        console.log(
          `Team size ${currentTeamSize} is below minimum requirement ${minTeamSize}`
        );
        continue;
      }

      if (participantIndex >= shuffledParticipants.length) break;

      // Get team members
      const teamMembers = shuffledParticipants.slice(
        participantIndex,
        participantIndex + currentTeamSize
      );
      participantIndex += currentTeamSize;

      // Pick random problem statement
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
            teamSize: currentTeamSize,
          },
        ],
        { session }
      );

      // Create team members
      const teamMemberParticipants = [];
      const teamMemberPromises = [];
      for (const [index, member] of teamMembers.entries()) {
        // First member is the team leader, others are developers
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
        teamMemberParticipants.push(member._id);
        // Update user's current hackathon
        await User.findByIdAndUpdate(
          member._id,
          { currentHackathonId: _id },
          { session }
        );
      }

      awaait team.save(teamMember : teamMemberParticipants);
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
      // for (const member of teamMembers) {
      //   const teammates = teamMembers
      //     .filter((m) => m._id.toString() !== member._id.toString())
      //     .map((m) => m.name);

      //   emailPromises.push(
      //     sendTeamNotification({
      //       email: member.email,
      //       name: member.name,
      //       hackathonTitle: title,
      //       teammates,
      //       problemStatement: randomProblem,
      //       teamName: teamName,
      //     })
      //   );
      // }
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
    const emailResults = await Promise.allSettled(emailPromises);

    // Log email sending results
    const successfulEmails = emailResults.filter(
      (r) => r.status === "fulfilled"
    ).length;
    const failedEmails = emailResults.filter(
      (r) => r.status === "rejected"
    ).length;

    console.log(
      `Emails sent: ${successfulEmails} successful, ${failedEmails} failed`
    );

    // Log failed emails for follow-up
    if (failedEmails > 0) {
      emailResults.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `Failed to send email to participant at index ${index}:`,
            result.reason
          );
          logger.error(`Failed to send email to participant: ${result.reason}`);
        }
      });
    }

    // Notify all connected clients
    // io.to(_id.toString()).emit("teams-formed", {
    //   hackathonId: _id,
    //   teams: createdTeams,
    // });

    console.log(
      `Successfully created ${createdTeams.length} teams for ${title}`
    );
    logger.info(
      `Successfully created ${createdTeams.length} teams for ${title}`
    );

    return createdTeams;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error creating teams for hackathon:", error);
    logger.error("Error creating teams for hackathon:", error);
    throw error;
  }
};
