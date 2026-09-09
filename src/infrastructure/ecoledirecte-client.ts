import { z } from "zod";
import type { EcoleDirecteClient } from "../domain/ports.js";
import {
  EcoleDirecteApiShapeError,
  SecurityChallengeError,
  type AbsenceItem,
  type Grade,
  type HomeworkItem,
  type MessageItem,
  type Student,
} from "../domain/types.js";

const API_BASE = "https://api.ecoledirecte.com/v3";
const API_VERSION = "4.60.0";

const LoginResponseSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  token: z.string().optional(),
  data: z
    .object({
      accounts: z.array(
        z.object({
          id: z.number(),
          prenom: z.string(),
          nom: z.string(),
          profile: z
            .object({
              classe: z.object({ libelle: z.string() }).optional(),
            })
            .optional(),
          eleves: z
            .array(
              z.object({
                id: z.number(),
                prenom: z.string(),
                nom: z.string(),
                classe: z.object({ libelle: z.string() }).optional(),
              }),
            )
            .optional(),
        }),
      ),
    })
    .optional(),
});

interface Credentials {
  username: string;
  password: string;
}

export class EcoleDirecteHttpClient implements EcoleDirecteClient {
  private token: string | undefined;
  private cachedStudents: Student[] | undefined;

  constructor(private readonly credentials: Credentials) {}

  private async ensureLoggedIn(): Promise<string> {
    if (this.token) return this.token;

    const body = new URLSearchParams({
      data: JSON.stringify({
        identifiant: this.credentials.username,
        motdepasse: this.credentials.password,
        isReLogin: false,
        uuid: "",
      }),
    });

    const res = await fetch(`${API_BASE}/login.awp?v=${API_VERSION}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const raw = await res.json();
    const parsed = LoginResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new EcoleDirecteApiShapeError("login.awp", parsed.error);
    }

    if (parsed.data.code === 250) {
      throw new SecurityChallengeError(
        parsed.data.message ?? "question de sécurité inconnue",
        parsed.data.token ?? "",
      );
    }

    if (parsed.data.code !== 200 || !parsed.data.token) {
      throw new Error(`Échec de connexion EcoleDirecte : ${parsed.data.message ?? parsed.data.code}`);
    }

    this.token = parsed.data.token;
    this.cachedStudents = (parsed.data.data?.accounts ?? []).flatMap((account) => {
      if (account.eleves && account.eleves.length > 0) {
        return account.eleves.map((eleve) => ({
          id: eleve.id,
          firstName: eleve.prenom,
          lastName: eleve.nom,
          className: eleve.classe?.libelle,
        }));
      }
      return [
        {
          id: account.id,
          firstName: account.prenom,
          lastName: account.nom,
          className: account.profile?.classe?.libelle,
        },
      ];
    });

    return this.token;
  }

  private async post<T>(endpoint: string, schema: z.ZodType<T>, query = ""): Promise<T> {
    const token = await this.ensureLoggedIn();
    const res = await fetch(`${API_BASE}${endpoint}?v=${API_VERSION}${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Token": token,
      },
      body: new URLSearchParams({ data: "{}" }),
    });

    if (res.status === 403) {
      this.token = undefined;
      return this.post(endpoint, schema, query);
    }

    const raw = await res.json();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new EcoleDirecteApiShapeError(endpoint, parsed.error);
    }
    return parsed.data;
  }

  async listStudents(): Promise<Student[]> {
    await this.ensureLoggedIn();
    return this.cachedStudents ?? [];
  }

  async getGrades(studentId: number): Promise<Grade[]> {
    const schema = z.object({
      data: z.object({
        notes: z.array(
          z.object({
            id: z.union([z.string(), z.number()]).transform(String),
            matiere: z.string(),
            valeur: z.string(),
            noteSur: z.string(),
            coef: z.string().optional(),
            date: z.string(),
            devoir: z.string().optional(),
          }),
        ),
      }),
    });
    const parsed = await this.post(`/eleves/${studentId}/notes.awp`, schema, "&verbe=get");
    return parsed.data.notes.map((n) => ({
      id: n.id,
      subject: n.matiere,
      value: n.valeur,
      scale: n.noteSur,
      coefficient: n.coef,
      date: n.date,
      comment: n.devoir,
    }));
  }

  async getHomework(studentId: number): Promise<HomeworkItem[]> {
    const schema = z.object({
      data: z.record(
        z.string(),
        z.array(
          z.object({
            matiere: z.string(),
            aFaire: z.object({ contenu: z.string().optional() }).optional(),
            done: z.boolean().optional(),
          }),
        ),
      ),
    });
    const parsed = await this.post(`/eleves/${studentId}/cahierdetexte.awp`, schema, "&verbe=get");
    return Object.entries(parsed.data).flatMap(([dueDate, items]) =>
      items.map((item) => ({
        subject: item.matiere,
        dueDate,
        description: item.aFaire?.contenu ?? "",
        done: item.done ?? false,
      })),
    );
  }

  async getAbsences(studentId: number): Promise<AbsenceItem[]> {
    const schema = z.object({
      data: z.object({
        absencesRetards: z.array(
          z.object({
            id: z.union([z.string(), z.number()]).transform(String),
            typeElement: z.string(),
            date: z.string(),
            motif: z.string().optional(),
            justifie: z.boolean().optional(),
          }),
        ),
      }),
    });
    const parsed = await this.post(`/eleves/${studentId}/viescolaire.awp`, schema, "&verbe=get");
    return parsed.data.absencesRetards.map((a) => ({
      id: a.id,
      type: (["absence", "retard", "sanction", "observation"].includes(a.typeElement)
        ? a.typeElement
        : "observation") as AbsenceItem["type"],
      date: a.date,
      reason: a.motif,
      justified: a.justifie,
    }));
  }

  async getMessages(): Promise<MessageItem[]> {
    const schema = z.object({
      data: z.object({
        messages: z.object({
          received: z.array(
            z.object({
              id: z.union([z.string(), z.number()]).transform(String),
              from: z.string(),
              subject: z.string(),
              date: z.string(),
              read: z.boolean(),
            }),
          ),
        }),
      }),
    });
    const parsed = await this.post("/familles/0/messages.awp", schema, "&typeRecuperation=received");
    return parsed.data.messages.received;
  }
}
