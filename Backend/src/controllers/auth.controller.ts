import { NextFunction, Request, Response } from "express";
import { authService } from "../services/auth.service";
import moment from "moment";
import { runtimeConfig } from "../config/runtime";

export const authController = {
  login: (req: Request, res: Response) => {
    const message = req.flash("message");
    return res.render("auth/login", {
      layout: false,
      message,
    });
  },
  handleLogin: async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const isLogin = await authService.login(
      {
        email,
        password,
      },
      req,
    );
    if (!isLogin) {
      req.flash("message", "Email hoac mat khau khong chinh xac");
      return res.redirect("/auth/login");
    }
    return res.redirect("/");
  },
  register: (req: Request, res: Response) => {
    const errors = JSON.parse(req.flash("errors")[0] || "{}");
    return res.render("auth/register", {
      layout: false,
      errors,
    });
  },
  handleRegister: async (req: Request, res: Response) => {
    const { name, email, password } = req.body;
    // console.log(hashPassword(password));
    await authService.register({
      name,
      email,
      password,
    });
    req.flash("message", "Dang ky tai khoan thanh cong");
    return res.redirect("/auth/login");
  },
  profile: (req: Request, res: Response) => {
    const user = req.user;
    return res.render("auth/profile", {
      user,
      moment,
    });
  },
  logout: (req: Request, res: Response, next: NextFunction) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie(runtimeConfig.sessionCookieName);
      return res.redirect("/auth/login");
    });
  },
};
