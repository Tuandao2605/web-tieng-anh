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

app.use(morgan("tiny"));
app.use(express.json());
app.use(express.urlencoded());
app.use(expressLayouts);
app.use(express.static("public"));

app.set("trust proxy", 1); // trust first proxy
app.use(
  session({
    secret: "aa8c487d27f4d34e2db32708b734c26d316b97769bc1909f929c67660bf421c5",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }),
);
app.use(flash());

app.set("layout", "layouts/main.layouts.ejs");
app.set("layout extractScripts", true);
app.set("layout extractStyles", true);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const frontendOrigin = ["http://localhost:5500", "http://127.0.0.1:5500"];
//Cors
const corsOptions = {
  origin: (
    origin: string,
    callback: (err: Error | null, origin?: boolean) => void,
  ) => {
    if (frontendOrigin.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error("Disallow by cors"));
    }
  },
  optionSuccessStatus: 200,
  credentials: true,
  allowedHeaders: ["Authorization", "Content-Type"],
} as CorsOptions;
//Route
app.use(routerWeb);
app.use("/api", cors(corsOptions), routerApi);

app.use(notFoundMiddleware);
app.use(errorHandlingMiddleware);

app.listen(port, () => {
  console.log(`Khoi dong server tai: http://localhost:${port}`);
});
