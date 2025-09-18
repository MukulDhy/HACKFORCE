import Team from "../models/team.model.js";
import User from "../models/user.model.js";
import Hackathon from "../models/hackthon.model.js";
import mongoose from "mongoose";

// Create a new team
export const createTeam = async (req, res) => {
  try {
    const {
      hackathonId,
      teamMember,
      name,
      description,
      problemStatement,
      technologies,
      communicationChannel,
    } = req.body;

    // Validate hackathon exists
    const hackathon = await Hackathon.findById(hackathonId);
    if (!hackathon) {
      return res.status(404).json({
        success: false,
        message: "Hackathon not found",
      });
    }

    // Validate team members exist
    if (teamMember && teamMember.length > 0) {
      const users = await User.find({ _id: { $in: teamMember } });
      if (users.length !== teamMember.length) {
        return res.status(404).json({
          success: false,
          message: "One or more team members not found",
        });
      }
    }

    const team = new Team({
      hackathonId,
      teamMember: teamMember || [],
      name,
      description,
      problemStatement,
      teamSize: teamMember ? teamMember.length : 0,
      technologies: technologies || [],
      communicationChannel,
    });

    await team.save();

    // Populate team data for response
    await team.populate([
      { path: "hackathonId", select: "title description" },
      { path: "teamMember", select: "name email" },
    ]);

    res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: team,
    });
  } catch (error) {
    console.error("Create team error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get all teams
export const getAllTeams = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      hackathonId,
      submissionStatus,
      isEligibleForPrize,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (hackathonId) query.hackathonId = hackathonId;
    if (submissionStatus) query.submissionStatus = submissionStatus;
    if (isEligibleForPrize !== undefined)
      query.isEligibleForPrize = isEligibleForPrize === "true";

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sortBy]: sortOrder === "desc" ? -1 : 1 },
      populate: [
        { path: "hackathonId", select: "title description startDate endDate" },
        { path: "teamMember", select: "name email" },
      ],
    };

    const teams = await Team.find(query)
      .populate(options.populate)
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await Team.countDocuments(query);

    res.status(200).json({
      success: true,
      data: teams,
      pagination: {
        current: options.page,
        total: Math.ceil(total / options.limit),
        count: teams.length,
        totalRecords: total,
      },
    });
  } catch (error) {
    console.error("Get all teams error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get team by ID
export const getTeamById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid team ID",
      });
    }

    const team = await Team.findById(id)
      .populate("hackathonId", "title description startDate endDate")
      .populate("teamMember", "name email profile");

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    res.status(200).json({
      success: true,
      data: team,
    });
  } catch (error) {
    console.error("Get team by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Update team
export const updateTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid team ID",
      });
    }

    // If updating team members, validate they exist
    if (updates.teamMember) {
      const users = await User.find({ _id: { $in: updates.teamMember } });
      if (users.length !== updates.teamMember.length) {
        return res.status(404).json({
          success: false,
          message: "One or more team members not found",
        });
      }
      updates.teamSize = updates.teamMember.length;
    }

    // If submitting, add timestamp
    if (updates.submissionStatus === "submitted" && !updates.submittedAt) {
      updates.submittedAt = new Date();
    }

    const team = await Team.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate("hackathonId", "title description")
      .populate("teamMember", "name email");

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Team updated successfully",
      data: team,
    });
  } catch (error) {
    console.error("Update team error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete team
export const deleteTeam = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid team ID",
      });
    }

    const team = await Team.findByIdAndDelete(id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Team deleted successfully",
    });
  } catch (error) {
    console.error("Delete team error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Add team member
export const addTeamMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID",
      });
    }

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    // Check if user is already a member
    if (team.teamMember.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: "User is already a team member",
      });
    }

    team.teamMember.push(userId);
    team.teamSize = team.teamMember.length;
    await team.save();

    await team.populate("teamMember", "name email");

    res.status(200).json({
      success: true,
      message: "Team member added successfully",
      data: team,
    });
  } catch (error) {
    console.error("Add team member error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Remove team member
export const removeTeamMember = async (req, res) => {
  try {
    const { id, userId } = req.params;

    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID",
      });
    }

    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    team.teamMember = team.teamMember.filter(
      (memberId) => !memberId.equals(userId)
    );
    team.teamSize = team.teamMember.length;
    await team.save();

    await team.populate("teamMember", "name email");

    res.status(200).json({
      success: true,
      message: "Team member removed successfully",
      data: team,
    });
  } catch (error) {
    console.error("Remove team member error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Submit team project
export const submitProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { projectRepo, projectDemo, projectPresentation } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid team ID",
      });
    }

    const team = await Team.findByIdAndUpdate(
      id,
      {
        $set: {
          projectRepo,
          projectDemo,
          projectPresentation,
          submissionStatus: "submitted",
          submittedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    ).populate("hackathonId teamMember");

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Project submitted successfully",
      data: team,
    });
  } catch (error) {
    console.error("Submit project error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get teams by hackathon
export const getTeamsByHackathon = async (req, res) => {
  try {
    const { hackathonId } = req.params;
    const { page = 1, limit = 10, sortBy = "rank" } = req.query;

    if (!mongoose.isValidObjectId(hackathonId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid hackathon ID",
      });
    }

    const teams = await Team.find({ hackathonId })
      .populate("teamMember", "name email")
      .sort({ [sortBy]: sortBy === "rank" ? 1 : -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Team.countDocuments({ hackathonId });

    res.status(200).json({
      success: true,
      data: teams,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: teams.length,
        totalRecords: total,
      },
    });
  } catch (error) {
    console.error("Get teams by hackathon error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Update team score and rank
export const updateScore = async (req, res) => {
  try {
    const { id } = req.params;
    const { score, rank, feedback } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid team ID",
      });
    }

    if (score !== undefined && (score < 0 || score > 100)) {
      return res.status(400).json({
        success: false,
        message: "Score must be between 0 and 100",
      });
    }

    const updateData = {};
    if (score !== undefined) updateData.score = score;
    if (rank !== undefined) updateData.rank = rank;
    if (feedback !== undefined) updateData.feedback = feedback;

    const team = await Team.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate("hackathonId teamMember");

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Team score updated successfully",
      data: team,
    });
  } catch (error) {
    console.error("Update score error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Disqualify team
export const disqualifyTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid team ID",
      });
    }

    const team = await Team.findByIdAndUpdate(
      id,
      {
        $set: {
          disqualified: true,
          disqualificationReason: reason,
          isEligibleForPrize: false,
        },
      },
      { new: true, runValidators: true }
    ).populate("hackathonId teamMember");

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Team disqualified successfully",
      data: team,
    });
  } catch (error) {
    console.error("Disqualify team error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get user's team by userId (uses user's current hackathon)
export const getUserTeam = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // First get the user to find their current hackathon
    const user = await User.findById(userId).select("currentHackathonId");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.currentHackathonId) {
      return res.status(404).json({
        success: false,
        message: "User is not registered for any current hackathon",
      });
    }

    // Find team where user is a member in their current hackathon
    const team = await Team.findOne({
      hackathonId: user.currentHackathonId,
      teamMember: userId,
    })
      .populate({
        path: "hackathonId",
        select: "title description startDate endDate status",
      })
      .populate({
        path: "teamMember",
        select: "name email profile avatar skills",
      });

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found for this user in current hackathon",
      });
    }

    res.status(200).json({
      success: true,
      data: team,
    });
  } catch (error) {
    console.error("Get user team error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get user's teams across all hackathons
export const getUserTeamsHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // Find all teams where user is a member
    const teams = await Team.find({
      teamMember: userId,
    })
      .populate({
        path: "hackathonId",
        select: "title description startDate endDate status",
      })
      .populate({
        path: "teamMember",
        select: "name email profile avatar",
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Team.countDocuments({ teamMember: userId });

    res.status(200).json({
      success: true,
      data: teams,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: teams.length,
        totalRecords: total,
      },
    });
  } catch (error) {
    console.error("Get user teams history error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get team by user ID and hackathon ID
export const getUserTeamByHackathon = async (req, res) => {
  try {
    const { userId, hackathonId } = req.params;

    if (
      !mongoose.isValidObjectId(userId) ||
      !mongoose.isValidObjectId(hackathonId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID or hackathon ID",
      });
    }

    const team = await Team.findOne({
      hackathonId: hackathonId,
      teamMember: userId,
    })
      .populate({
        path: "hackathonId",
        select: "title description startDate endDate status rules prizes",
      })
      .populate({
        path: "teamMember",
        select: "name email profile avatar skills experience",
      });

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found for this user in the specified hackathon",
      });
    }

    res.status(200).json({
      success: true,
      data: team,
    });
  } catch (error) {
    console.error("Get user team by hackathon error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Check if user is in any team for current hackathon
export const checkUserTeamStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // Get user's current hackathon
    const user = await User.findById(userId).select("currentHackathonId");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.currentHackathonId) {
      return res.status(200).json({
        success: true,
        hasTeam: false,
        message: "User is not registered for any current hackathon",
      });
    }

    // Check if user is in any team
    const teamExists = await Team.exists({
      hackathonId: user.currentHackathonId,
      teamMember: userId,
    });

    res.status(200).json({
      success: true,
      hasTeam: !!teamExists,
      hackathonId: user.currentHackathonId,
      message: teamExists
        ? "User is part of a team"
        : "User is not part of any team",
    });
  } catch (error) {
    console.error("Check user team status error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get available teams for user to join (in current hackathon)
export const getAvailableTeamsForUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // Get user's current hackathon
    const user = await User.findById(userId).select("currentHackathonId");
    if (!user || !user.currentHackathonId) {
      return res.status(404).json({
        success: false,
        message: "User not found or not registered for any hackathon",
      });
    }

    // Find teams in current hackathon that:
    // 1. User is not already a member of
    // 2. Are not disqualified
    // 3. Have space for more members (optional - you can add max team size logic)
    const teams = await Team.find({
      hackathonId: user.currentHackathonId,
      teamMember: { $nin: [userId] },
      disqualified: false,
    })
      .populate({
        path: "hackathonId",
        select: "title maxTeamSize",
      })
      .populate({
        path: "teamMember",
        select: "name email profile avatar skills",
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Team.countDocuments({
      hackathonId: user.currentHackathonId,
      teamMember: { $nin: [userId] },
      disqualified: false,
    });

    res.status(200).json({
      success: true,
      data: teams,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: teams.length,
        totalRecords: total,
      },
    });
  } catch (error) {
    console.error("Get available teams error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Join existing team (user requests to join)
export const joinTeam = async (req, res) => {
  try {
    const { userId, teamId } = req.params;

    if (
      !mongoose.isValidObjectId(userId) ||
      !mongoose.isValidObjectId(teamId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID or team ID",
      });
    }

    // Check if user exists and get their current hackathon
    const user = await User.findById(userId).select("currentHackathonId");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find the team
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    // Check if team belongs to user's current hackathon
    if (!team.hackathonId.equals(user.currentHackathonId)) {
      return res.status(400).json({
        success: false,
        message: "Team does not belong to user's current hackathon",
      });
    }

    // Check if user is already in the team
    if (team.teamMember.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: "User is already a member of this team",
      });
    }

    // Check if user is already in another team for this hackathon
    const existingTeam = await Team.exists({
      hackathonId: user.currentHackathonId,
      teamMember: userId,
    });

    if (existingTeam) {
      return res.status(400).json({
        success: false,
        message: "User is already part of another team in this hackathon",
      });
    }

    // Add user to team
    team.teamMember.push(userId);
    team.teamSize = team.teamMember.length;
    await team.save();

    // Populate and return updated team
    await team.populate([
      { path: "hackathonId", select: "title description" },
      { path: "teamMember", select: "name email profile avatar" },
    ]);

    res.status(200).json({
      success: true,
      message: "Successfully joined the team",
      data: team,
    });
  } catch (error) {
    console.error("Join team error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Leave team
export const leaveTeam = async (req, res) => {
  try {
    const { userId, teamId } = req.params;

    if (
      !mongoose.isValidObjectId(userId) ||
      !mongoose.isValidObjectId(teamId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID or team ID",
      });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    // Check if user is a member
    if (!team.teamMember.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: "User is not a member of this team",
      });
    }

    // Remove user from team
    team.teamMember = team.teamMember.filter(
      (memberId) => !memberId.equals(userId)
    );
    team.teamSize = team.teamMember.length;

    // If team becomes empty, you might want to delete it or mark it inactive
    if (team.teamSize === 0) {
      await Team.findByIdAndDelete(teamId);
      return res.status(200).json({
        success: true,
        message: "Left team successfully. Team was deleted as it became empty.",
      });
    }

    await team.save();
    await team.populate([
      { path: "hackathonId", select: "title description" },
      { path: "teamMember", select: "name email profile avatar" },
    ]);

    res.status(200).json({
      success: true,
      message: "Left team successfully",
      data: team,
    });
  } catch (error) {
    console.error("Leave team error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
