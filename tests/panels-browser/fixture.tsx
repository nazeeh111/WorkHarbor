import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { CompanyProvider } from "../../ui/src/context/CompanyContext";
import { BreadcrumbProvider } from "../../ui/src/context/BreadcrumbContext";
import { SkillStudio } from "../../ui/src/pages/SkillStudio";
import "../../ui/src/index.css";

// Real SkillStudio, persistence callbacks, wrapper, and library. Only the API
// responses are replaced by browser routes; no server, database or agent starts.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <BrowserRouter>
      <CompanyProvider>
        <BreadcrumbProvider>
          <main className="h-screen min-h-0">
            <Routes><Route path="/skills/studio/:skillId" element={<SkillStudio />} /></Routes>
          </main>
        </BreadcrumbProvider>
      </CompanyProvider>
    </BrowserRouter>
  </QueryClientProvider>,
);
