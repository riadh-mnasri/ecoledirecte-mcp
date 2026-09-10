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
const API_VERSION = "4.101.4";

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
              eleves: z
                .array(
                  z.object({
                    id: z.number(),
                    prenom: z.string(),
                    nom: z.string(),
                  }),
                )
                .optional(),
            })
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

function decodeBase64Html(value: string): string {
  const html = Buffer.from(value, "base64").toString("utf-8");
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export class EcoleDirecteHttpClient implements EcoleDirecteClient {
  private token: string | undefined;
  private familyId: number | undefined;
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
    const account = parsed.data.data?.accounts[0];
    this.familyId = account?.id;
    this.cachedStudents = (account?.profile?.eleves ?? []).map((eleve) => ({
      id: eleve.id,
      firstName: eleve.prenom,
      lastName: eleve.nom,
    }));

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
        periodes: z.array(
          z.object({
            periode: z.string(),
            ensembleMatieres: z.object({
              disciplines: z.array(
                z.object({
                  id: z.union([z.string(), z.number()]).transform(String),
                  discipline: z.string(),
                  moyenne: z.string(),
                  moyenneClasse: z.string().optional(),
                  moyenneMin: z.string().optional(),
                  moyenneMax: z.string().optional(),
                  coef: z.union([z.string(), z.number()]).transform(String).optional(),
                }),
              ),
            }),
          }),
        ),
      }),
    });
    const parsed = await this.post(`/eleves/${studentId}/notes.awp`, schema, "&verbe=get");
    return parsed.data.periodes.flatMap((periode) =>
      periode.ensembleMatieres.disciplines
        .filter((d) => d.moyenne !== "")
        .map((d) => ({
          id: `${periode.periode}-${d.id}`,
          subject: d.discipline,
          value: d.moyenne,
          scale: "20",
          coefficient: d.coef,
          date: periode.periode,
          comment: d.moyenneClasse ? `Moyenne de classe : ${d.moyenneClasse}` : undefined,
        })),
    );
  }

  async getHomework(studentId: number): Promise<HomeworkItem[]> {
    const listSchema = z.object({
      data: z.record(
        z.string(),
        z.array(
          z.object({
            matiere: z.string(),
            idDevoir: z.number(),
            donneLe: z.string(),
            effectue: z.boolean(),
          }),
        ),
      ),
    });
    const detailSchema = z.object({
      data: z.object({
        matieres: z.array(
          z.object({
            matiere: z.string(),
            aFaire: z.object({ contenu: z.string().optional() }).optional(),
          }),
        ),
      }),
    });

    const list = await this.post(`/Eleves/${studentId}/cahierdetexte.awp`, listSchema, "&verbe=get");

    const entries = Object.entries(list.data);
    const perDate = await Promise.all(
      entries.map(async ([dueDate, items]) => {
        const detail = await this.post(
          `/Eleves/${studentId}/cahierdetexte/${dueDate}.awp`,
          detailSchema,
          "&verbe=get",
        );
        return items.map((item): HomeworkItem => {
          const matiereDetail = detail.data.matieres.find((m) => m.matiere === item.matiere);
          const contenu = matiereDetail?.aFaire?.contenu;
          return {
            subject: item.matiere,
            dueDate,
            description: contenu ? decodeBase64Html(contenu) : "",
            done: item.effectue,
          };
        });
      }),
    );

    return perDate.flat();
  }

  async getAbsences(studentId: number): Promise<AbsenceItem[]> {
    // Endpoint confirmé (`/eleves/{id}/viescolaire.awp`), mais forme exacte de la réponse
    // non vérifiée par capture réseau : à ajuster au premier échec de schéma en usage réel.
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
    // Endpoint et paramètres confirmés (`/familles/{familyId}/messages.awp?typeRecuperation=received...`),
    // mais forme exacte du corps de la réponse non vérifiée : à ajuster au premier échec de schéma.
    await this.ensureLoggedIn();
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
    const parsed = await this.post(
      `/familles/${this.familyId}/messages.awp`,
      schema,
      "&typeRecuperation=received&orderBy=date&order=desc&onlyRead=0&getAll=1",
    );
    return parsed.data.messages.received;
  }
}
