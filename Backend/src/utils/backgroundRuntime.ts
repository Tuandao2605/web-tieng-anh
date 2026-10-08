export const assertBackgroundWorkerRole = () => {
  if (process.env.BACKGROUND_RUNTIME_ROLE !== "worker") {
    throw new Error(
      "Background jobs may only start in BACKGROUND_RUNTIME_ROLE=worker",
    );
  }
};
