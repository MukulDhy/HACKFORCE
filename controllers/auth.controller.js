import User from "../models/user.model.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config({ path: "../config/config.env" });
import { OAuth2Client } from "google-auth-library";
//import sendMail from "../utils/sendMail.js";
import { sendResponse, ErrorCodes } from "../utils/responseHandler.js";
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  AppError,
} from "../utils/appError.js";

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Helper function to send token response
const sendTokenResponse = (user, statusCode, res, message) => {
  const token = user.generateToken();

  const options = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  const userData = {
    id: user._id,
    name: user.name,
    email: user.email,
    isEmailVerified: user.isEmailVerified,
    profilePicture: user.profilePicture,
  };

  res
    .status(statusCode)
    .cookie("token", token, options)
    .json({
      success: true,
      data: { user: userData, token },
      message,
      errorCode: ErrorCodes.SUCCESS,
    });
};

// Helper function to send verification email
const sendVerificationEmail = async (user) => {
  try {
    const verificationToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    const verificationURL = `${process.env.CLIENT_URL}/verify-email/${verificationToken}`;

    const message = `
      <h2>Email Verification</h2>
      <p>Please click the link below to verify your email address:</p>
      <a href="${verificationURL}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a>
      <p>If you didn't create this account, please ignore this email.</p>
    `;

    // await sendMail({
    //   from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    //   to: user.email,
    //   subject: "Verify Your Email Address",
    //   html: message,
    // });
  } catch (error) {
    console.error("Email verification send error:", error);
    throw new AppError(
      "Failed to send verification email",
      500,
      ErrorCodes.INTERNAL_SERVER_ERROR
    );
  }
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res, next) => {
  try {
    const userData = req.body;
    const { email } = userData;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError(
        "User already exists with this email",
        400,
        ErrorCodes.DUPLICATE_ENTRY
      );
    }

    // Create new user
    const user = await User.create({
      ...userData,
    });

    // Send welcome email
    try {
      const data = { user: { name: user.name, email: user.email } };
      const res = true;
      // const res = await sendMail({
      //   email: user.email,
      //   subject: "Mail from HackMate",
      //   data,
      //   template: "welcome_mail.ejs",
      // });
      console.log("EMAIL : ", res);
    } catch (emailError) {
      // Log email error but don't fail the registration
      console.error("Email sending failed:", emailError);
    }

    sendTokenResponse(user, 201, res, "User registered successfully");
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      next(new ValidationError(messages.join(", ")));
    } else {
      next(error);
    }
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      throw new ValidationError("Please provide email and password");
    }

    // Find user and include password for comparison
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      throw new UnauthorizedError("Invalid credentials");
    }

    // Check if account is active
    if (!user.isActive) {
      throw new UnauthorizedError("Account has been deactivated");
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      throw new UnauthorizedError("Invalid Password");
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    sendTokenResponse(user, 200, res, "Login successful");
  } catch (error) {
    next(error);
  }
};

// @desc    Google OAuth login
// @route   POST /api/auth/google
// @access  Public
export const googleAuth = async (req, res, next) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      throw new ValidationError("Google credential is required");
    }

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, picture, email_verified } = payload;

    // Check if user exists
    let user = await User.findOne({ email });

    if (user) {
      // Update last login
      user.lastLogin = new Date();
      if (!user.isEmailVerified && email_verified) {
        user.isEmailVerified = true;
      }
      if (
        picture &&
        (!user.profilePicture || user.profilePicture === "default-avatar.png")
      ) {
        user.profilePicture = picture;
      }
      await user.save({ validateBeforeSave: false });
    } else {
      // Create new user
      user = await User.create({
        name,
        email,
        password: crypto.randomBytes(32).toString("hex"), // Random password for Google users
        isEmailVerified: email_verified,
        profilePicture: picture || "default-avatar.png",
        lastLogin: new Date(),
      });
    }
    sendTokenResponse(user, 200, res, "Google authentication successful");
  } catch (error) {
    next(error);
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      throw new NotFoundError("User not found");
    }

    sendResponse(
      res,
      200,
      { user },
      "User retrieved successfully",
      ErrorCodes.SUCCESS
    );
  } catch (error) {
    next(error);
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
export const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = [
      "name",
      "age",
      "skills",
      "experience",
      "github",
      "linkedin",
      "phone",
      "profilePicture",
    ];
    const updates = {};

    // Filter allowed fields
    Object.keys(req.body).forEach((key) => {
      if (allowedFields.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const user = await User.findByIdAndUpdate(req.user.id, updates, {
      new: true,
      runValidators: true,
    });

    sendResponse(
      res,
      200,
      { user },
      "Profile updated successfully",
      ErrorCodes.SUCCESS
    );
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      next(new ValidationError(messages.join(", ")));
    } else {
      next(error);
    }
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new ValidationError(
        "Please provide current password and new password"
      );
    }

    const user = await User.findById(req.user.id).select("+password");

    // Check current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedError("Current password is incorrect");
    }

    // Update password
    user.password = newPassword;
    await user.save();

    sendResponse(
      res,
      200,
      null,
      "Password changed successfully",
      ErrorCodes.SUCCESS
    );
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      next(new ValidationError(messages.join(", ")));
    } else {
      next(error);
    }
  }
};

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new ValidationError("Please provide email address");
    }

    const user = await User.findOne({ email });

    if (!user) {
      throw new NotFoundError("User not found with this email");
    }

    // Generate reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // Send reset email
    const resetURL = `${req.protocol}://${req.get(
      "host"
    )}/api/auth/reset-password/${resetToken}`;

    const message = `
      <h2>Password Reset Request</h2>
      <p>You requested a password reset. Click the link below to reset your password:</p>
      <a href="${resetURL}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
      <p>This link will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `;

    try {
      // await sendMail({
      //   from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      //   to: user.email,
      //   subject: "Password Reset Request",
      //   html: message,
      // });

      sendResponse(
        res,
        200,
        null,
        "Password reset email sent",
        ErrorCodes.SUCCESS
      );
    } catch (error) {
      console.error("Email send error:", error);

      // Clear reset token fields
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });

      throw new AppError(
        "Email could not be sent",
        500,
        ErrorCodes.INTERNAL_SERVER_ERROR
      );
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
export const resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      throw new ValidationError("Please provide new password");
    }

    // Hash the token to compare with stored hash
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      throw new UnauthorizedError("Invalid or expired reset token");
    }

    // Set new password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    sendTokenResponse(user, 200, res, "Password reset successful");
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      next(new ValidationError(messages.join(", ")));
    } else {
      next(error);
    }
  }
};

// @desc    Send email verification
// @route   POST /api/auth/send-verification
// @access  Private
export const sendEmailVerification = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    if (user.isEmailVerified) {
      throw new ValidationError("Email is already verified");
    }

    await sendVerificationEmail(user);

    sendResponse(res, 200, null, "Verification email sent", ErrorCodes.SUCCESS);
  } catch (error) {
    next(error);
  }
};

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    // In a real app, you'd want to use a proper email verification token
    // For simplicity, using JWT here
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);

    if (!user) {
      throw new UnauthorizedError("Invalid verification token");
    }

    user.isEmailVerified = true;
    await user.save({ validateBeforeSave: false });

    sendResponse(
      res,
      200,
      null,
      "Email verified successfully",
      ErrorCodes.SUCCESS
    );
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new UnauthorizedError("Verification token has expired");
    } else if (error.name === "JsonWebTokenError") {
      throw new UnauthorizedError("Invalid verification token");
    }
    next(error);
  }
};

// @desc    Verify profile
// @route   GET /api/auth/verify-profile
// @access  Private
export const verifyingProfile = async (req, res, next) => {
  try {
    const user = req.user;
    sendResponse(
      res,
      200,
      { user },
      "Token verification successful",
      ErrorCodes.SUCCESS
    );
  } catch (error) {
    throw new UnauthorizedError("Verification Token Failed");
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
export const logout = async (req, res, next) => {
  try {
    res.cookie("token", "none", {
      expires: new Date(Date.now() + 10 * 1000),
      httpOnly: true,
    });

    sendResponse(res, 200, null, "Logged out successfully", ErrorCodes.SUCCESS);
  } catch (error) {
    next(error);
  }
};

// @desc    Deactivate account
// @route   PUT /api/auth/deactivate
// @access  Private
export const deactivateAccount = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    user.isActive = false;
    await user.save({ validateBeforeSave: false });

    res.cookie("token", "none", {
      expires: new Date(Date.now() + 10 * 1000),
      httpOnly: true,
    });

    sendResponse(
      res,
      200,
      null,
      "Account deactivated successfully",
      ErrorCodes.SUCCESS
    );
  } catch (error) {
    next(error);
  }
};
