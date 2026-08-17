import "dotenv/config";
// import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";

// const config = {
//   host: process.env.DB_HOST ?? "",
//   user: process.env.DB_USERNAME ?? "",
//   password: process.env.DB_PASSWORD ?? "",
//   database: process.env.DB_DATABASE ?? "",
//   port: process.env.DB_PORT as unknown as number,
//   connectionLimit: 5,
// };

// const adapter = new PrismaMariaDb(process.env.DATABASE_URL as string);

// const prisma = new PrismaClient({
//     adapter,
//     omit :{
//         user: {
//             // password: true,
//         }
//     } ,
//     log:["query"],
// });
const isDev = process.env.NODE_ENV === "development";
const prisma = new PrismaClient({
  log: isDev ? ["query"] : [],
});

export { prisma };
