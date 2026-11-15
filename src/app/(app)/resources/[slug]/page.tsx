import Link from "next/link";
import { notFound } from "next/navigation";
import { getResourceBySlugAction } from "@/modules/library/actions";

export default async function ResourceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resource = await getResourceBySlugAction(slug);

  if (!resource) notFound();

  // BR-LIB-02: keenam bidang wajib tampil; bidang kosong diberi penanda jujur,
  // bukan dibuang atau diisi informasi karangan.
  const sections = [
    ["Cara Akses / Setup", resource.accessSetup],
    ["Cara Penggunaan", resource.howToUse],
    ["Contoh Workflow", resource.workflowExamples],
    ["Batasan & Catatan", resource.limitationsCautions],
    ["Sumber Resmi", resource.officialSources],
    ["Status Dokumentasi", resource.documentationStatus],
  ];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-16">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/resources" className="text-primary hover:underline">Resource Library</Link>
        <span aria-hidden="true">/</span>
        <span className="truncate">{resource.name}</span>
      </div>

      <header className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-accent px-2.5 py-1 font-semibold text-primary">{resource.category}</span>
          {resource.tags.map((tag) => <span key={tag} className="rounded-full bg-surface-container px-2.5 py-1">#{tag}</span>)}
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-on-surface">{resource.name}</h1>
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">{resource.description}</p>
        {resource.officialUrl && (
          <a href={resource.officialUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline">
            Buka sumber resmi
          </a>
        )}
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {sections.map(([title, content]) => (
          <article key={title} className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">{title}</h2>
            <p className={`mt-3 whitespace-pre-wrap text-sm leading-relaxed ${content ? "text-on-surface-variant" : "italic text-muted-foreground"}`}>
              {content || "Belum didokumentasikan"}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
