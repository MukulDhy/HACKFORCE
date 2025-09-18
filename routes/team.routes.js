import express from "express";
import {
  createTeam,
  getAllTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  submitProject,
  getTeamsByHackathon,
  updateScore,
  disqualifyTeam,
  getUserTeam,
  getUserTeamsHistory,
  getUserTeamByHackathon,
  checkUserTeamStatus,
  getAvailableTeamsForUser,
  joinTeam,
  leaveTeam,
} from "../controllers/team.controller.js";

const router = express.Router();

// Basic CRUD operations
router.post("/", createTeam);
router.get("/", getAllTeams);
router.get("/:id", getTeamById);
router.put("/:id", updateTeam);
router.delete("/:id", deleteTeam);

// Team member management
router.post("/:id/members", addTeamMember);
router.delete("/:id/members/:userId", removeTeamMember);

// Project submission
router.post("/:id/submit", submitProject);

// Hackathon specific operations
router.get("/hackathon/:hackathonId", getTeamsByHackathon);

// Scoring and evaluation
router.put("/:id/score", updateScore);
router.put("/:id/disqualify", disqualifyTeam);

// User-specific team operations (using currentHackathonId from User model)
router.get("/user/:userId", getUserTeam); // Get user's team in current hackathon
router.get("/user/:userId/history", getUserTeamsHistory); // Get all user's teams across hackathons
router.get("/user/:userId/hackathon/:hackathonId", getUserTeamByHackathon); // Get user's team in specific hackathon
router.get("/user/:userId/status", checkUserTeamStatus); // Check if user has a team in current hackathon
router.get("/user/:userId/available", getAvailableTeamsForUser); // Get teams user can join in current hackathon

// Team joining/leaving operations
router.post("/user/:userId/join/:teamId", joinTeam); // Join existing team
router.delete("/user/:userId/leave/:teamId", leaveTeam); // Leave team

export default router;
