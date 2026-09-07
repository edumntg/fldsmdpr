import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/gabarito";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
