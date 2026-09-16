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
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

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
  private sessionCookie: string | undefined;

  constructor(private readonly credentials: Credentials) {}

  private async fetchGtk(): Promise<{ gtk: string; cookieHeader: string }> {
    const res = await fetch(`${API_BASE}/login.awp?gtk=1&v=${API_VERSION}`, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
    });

    const cookies = res.headers.getSetCookie();
    const gtkCookie = cookies.find((c) => c.startsWith("GTK="));
    if (!gtkCookie) {
      throw new Error("Échec de connexion EcoleDirecte : impossible de récupérer le cookie GTK");
    }
    return {
      gtk: gtkCookie.split(";")[0].split("=")[1],
      cookieHeader: cookies.map((c) => c.split(";")[0]).join("; "),
    };
  }

  private async ensureLoggedIn(): Promise<string> {
    if (this.token) return this.token;

    const { gtk, cookieHeader } = await this.fetchGtk();

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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        "X-Gtk": gtk,
        Cookie: cookieHeader,
      },
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
    this.sessionCookie = cookieHeader;
    const account = parsed.data.data?.accounts[0];
    this.familyId = account?.id;
    this.cachedStudents = (account?.profile?.eleves ?? []).map((eleve) => ({
      id: eleve.id,
      firstName: eleve.prenom,
      lastName: eleve.nom,
    }));

    return this.token;
  }

  private async post<T>(endpoint: string, schema: z.ZodType<T>, query = "", retried = false): Promise<T> {
    const token = await this.ensureLoggedIn();
    const res = await fetch(`${API_BASE}${endpoint}?v=${API_VERSION}${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Token": token,
        "User-Agent": USER_AGENT,
        ...(this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
      },
      body: new URLSearchParams({ data: "{}" }),
    });

    if (res.status === 403) {
      this.token = undefined;
      return this.post(endpoint, schema, query, true);
    }

    const raw = await res.json();

    // Une session expirée renvoie une erreur applicative (`code` JSON != 200) avec un statut HTTP 200,
    // ce que le cas ci-dessus (403) ne couvre pas. Sans ce contrôle, l'erreur de session est prise à tort
    // pour un changement de format d'API (EcoleDirecteApiShapeError) par le safeParse ci-dessous.
    if (raw && typeof raw === "object" && "code" in raw && (raw as { code: unknown }).code !== 200) {
      const code = (raw as { code: unknown }).code;
      const message = (raw as { message?: string }).message ?? `code ${code}`;
      if (!retried) {
        this.token = undefined;
        return this.post(endpoint, schema, query, true);
      }
      throw new Error(`Erreur API EcoleDirecte sur ${endpoint} : ${message}`);
    }

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
    // Endpoint et paramètres confirmés par capture réseau :
    // - `verbe=get` est requis, sinon l'API renvoie code 225 "Paramètres spécifiés incorrects" sans champ `data`.
    // - `onlyRead=1` est requis pour obtenir la liste complète (contre-intuitif : `onlyRead=0` renvoie 0 résultat).
    // - La liste ne contient pas le corps du message (`content` vide) : il faut un appel détail par message.
    await this.ensureLoggedIn();
    const listSchema = z.object({
      data: z.object({
        messages: z.object({
          received: z.array(
            z.object({
              id: z.union([z.string(), z.number()]).transform(String),
              from: z.object({
                civilite: z.string().optional(),
                prenom: z.string().optional(),
                nom: z.string().optional(),
              }),
              subject: z.string(),
              date: z.string(),
              read: z.boolean(),
            }),
          ),
        }),
      }),
    });
    const list = await this.post(
      `/familles/${this.familyId}/messages.awp`,
      listSchema,
      "&verbe=get&typeRecuperation=received&orderBy=date&order=desc&onlyRead=1&getAll=1",
    );

    const detailSchema = z.object({
      data: z.object({
        content: z.string().optional(),
      }),
    });

    return Promise.all(
      list.data.messages.received.map(async (item): Promise<MessageItem> => {
        const detail = await this.post(
          `/familles/${this.familyId}/messages/${item.id}.awp`,
          detailSchema,
          "&verbe=get&mode=destinataire",
        );
        return {
          id: item.id,
          from: [item.from.civilite, item.from.prenom, item.from.nom].filter(Boolean).join(" "),
          subject: item.subject,
          date: item.date,
          read: item.read,
          content: detail.data.content ? decodeBase64Html(detail.data.content) : undefined,
        };
      }),
    );
  }
}
