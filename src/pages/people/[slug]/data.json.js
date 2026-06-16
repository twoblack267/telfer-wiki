// @ts-check
/** @type {import('astro').GetStaticPaths} */
export async function getStaticPaths() {
  const peopleData = (await import("@data/people.public.json")).default;
  return peopleData.map((p) => ({ params: { slug: p.slug } }));
}

/** @type {import('astro').APIRoute} */
export async function GET({ params }) {
  const peopleData = (await import("@data/people.public.json")).default;
  const { slug } = params;

  if (!slug) {
    return new Response(JSON.stringify({ error: "Missing slug" }), { status: 400 });
  }

  const person = peopleData.find((p) => p.slug === slug);

  if (!person) {
    return new Response(JSON.stringify({ error: "Person not found" }), { status: 404 });
  }

  return new Response(JSON.stringify(person), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600"
    }
  });
}