import React from "react";
import ReactDOM from "react-dom/client";
import RunSetup from "./pages/RunSetup";
import RunDetail from "./pages/RunDetail";
import TestResults from "./pages/TestResults";

const path = window.location.pathname;
const page = path.startsWith("/run")
  ? <RunDetail />
  : path.startsWith("/tests")
    ? <TestResults />
    : <RunSetup />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{page}</React.StrictMode>,
);
