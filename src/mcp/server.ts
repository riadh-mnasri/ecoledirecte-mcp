import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EcoleDirecteClient, ResultCache } from "../domain/ports.js";
import { SecurityChallengeError } from "../domain/types.js";
import { resilientFetch } from "./resilient-fetch.js";

function toContent(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

function toErrorContent(error: unknown) {
  const message =
    error instanceof SecurityChallengeError
      ? `${error.message}. Connecte-toi une fois manuellement sur ecoledirecte.com depuis cet appareil pour lever le blocage, puis réessaie.`
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: "text" as const, text: `Erreur : ${message}` }], isError: true };
}

export function createServer(client: EcoleDirecteClient, cache: ResultCache): McpServer {
  const server = new McpServer({ name: "ecoledirecte-mcp", version: "0.1.0" });

  server.registerTool(
    "lister_eleves",
    { description: "Liste les élèves rattachés au compte EcoleDirecte connecté." },
    async () => {
      try {
        const result = await resilientFetch(cache, "eleves", () => client.listStudents());
        return toContent(result);
      } catch (error) {
        return toErrorContent(error);
      }
    },
  );

  server.registerTool(
    "consulter_notes",
    {
      description: "Récupère les notes d'un élève.",
      inputSchema: { studentId: z.number().describe("Identifiant EcoleDirecte de l'élève (voir lister_eleves)") },
    },
    async ({ studentId }) => {
      try {
        const result = await resilientFetch(cache, `notes-${studentId}`, () => client.getGrades(studentId));
        return toContent(result);
      } catch (error) {
        return toErrorContent(error);
      }
    },
  );

  server.registerTool(
    "consulter_devoirs",
    {
      description: "Récupère le cahier de texte (devoirs à faire) d'un élève.",
      inputSchema: { studentId: z.number().describe("Identifiant EcoleDirecte de l'élève (voir lister_eleves)") },
    },
    async ({ studentId }) => {
      try {
        const result = await resilientFetch(cache, `devoirs-${studentId}`, () => client.getHomework(studentId));
        return toContent(result);
      } catch (error) {
        return toErrorContent(error);
      }
    },
  );

  server.registerTool(
    "consulter_absences",
    {
      description: "Récupère les absences, retards et sanctions d'un élève.",
      inputSchema: { studentId: z.number().describe("Identifiant EcoleDirecte de l'élève (voir lister_eleves)") },
    },
    async ({ studentId }) => {
      try {
        const result = await resilientFetch(cache, `absences-${studentId}`, () => client.getAbsences(studentId));
        return toContent(result);
      } catch (error) {
        return toErrorContent(error);
      }
    },
  );

  server.registerTool(
    "consulter_messages",
    { description: "Récupère les messages reçus dans la messagerie EcoleDirecte du compte." },
    async () => {
      try {
        const result = await resilientFetch(cache, "messages", () => client.getMessages());
        return toContent(result);
      } catch (error) {
        return toErrorContent(error);
      }
    },
  );

  return server;
}
