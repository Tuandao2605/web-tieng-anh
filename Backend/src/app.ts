import dotenv from "dotenv";
dotenv.config();
import express, { Application } from "express";
import path from "node:path";
import expressLayouts from "express-ejs-layouts";
import morgan from "morgan";
import "./scheduler";
import "./subscribers/order";
import "./web-socket/socket-server";
// import "./consumer";
import cors, { CorsOptions } from "cors";
import routerWeb from "./routes/web";
import routerApi from "./routes/api";
import session from "express-session";
import flash from "connect-flash";
import {
  errorHandlingMiddleware,
  notFoundMiddleware,
} from "./middlewares/error.middleware";

const app: Application = express();
const port: number = 3000;

if (process.env.NODE_ENV === "development") {
  app.use(morgan("tiny"));
}
app.use(express.json());
app.use(express.urlencoded());
app.use(expressLayouts);
app.use(express.static("public"));

app.set("trust proxy", 1); // trust first proxy
const webSessionMiddleware = session({
  secret: process.env.SESSION_SECRET ?? "local-development-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false },
});

app.set("layout", "layouts/main.layouts.ejs");
app.set("layout extractScripts", true);
app.set("layout extractStyles", true);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const frontendOrigin = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000", // Vite proxy same-origin
];

// Cors
const corsOptions: CorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Cho phép: request không có origin (curl, server-to-server) hoặc nằm trong whitelist
    if (!origin || frontendOrigin.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Disallow by cors: ${origin}`));
    }
  },
  optionsSuccessStatus: 200,
  credentials: true,
  allowedHeaders: ["Authorization", "Content-Type"],
  // Browser cache preflight Authorization/JSON requests for one day.
  maxAge: 86400,
};

// JWT APIs do not need express-session. Mounting them first avoids allocating,
// loading and saving a server session for every API request.
app.use("/api", cors(corsOptions), routerApi);

// Session and flash are only needed by the server-rendered web routes.
app.use(webSessionMiddleware);
app.use(flash());
//Route
app.use(routerWeb);

app.use(notFoundMiddleware);
app.use(errorHandlingMiddleware);

app.listen(port, () => {
  console.log(`Khoi dong server tai: http://localhost:${port}`);
});
