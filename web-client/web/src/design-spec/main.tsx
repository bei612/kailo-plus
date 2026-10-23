// DD-141 visual specimen entry (.design/20 §12). Dev-server only: `vite build`
// bundles index.html alone, so nothing here reaches the deployed Web.
import "@fontsource-variable/inter/wght.css";
import "@/shared/styles/globals.css";
import ReactDOM from "react-dom/client";
import { DesignSpec, readSpecParams } from "./DesignSpec";

const params = readSpecParams(window.location.search);
const root = document.getElementById("root");
if (root) ReactDOM.createRoot(root).render(<DesignSpec {...params} />);
