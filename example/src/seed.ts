import "dotenv/config";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getPayload } from "payload";
import config from "./payload.config";
import type { Category, Media, Page, Post } from "./payload-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
type RichTextContent = NonNullable<Post["content"]>;

// Helper to create Lexical richtext content
function lexicalContent(paragraphs: string[]): RichTextContent {
  return {
    root: {
      type: "root",
      children: paragraphs.map((text) => ({
        type: "paragraph",
        children: [{ type: "text", text, version: 1 }],
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
      })),
      direction: "ltr",
      format: "",
      indent: 0,
      version: 1,
    },
  };
}

function lexicalWithHeading(
  heading: string,
  paragraphs: string[],
): RichTextContent {
  return {
    root: {
      type: "root",
      children: [
        {
          type: "heading",
          tag: "h2",
          children: [{ type: "text", text: heading, version: 1 }],
          direction: "ltr",
          format: "",
          indent: 0,
          version: 1,
        },
        ...paragraphs.map((text) => ({
          type: "paragraph",
          children: [{ type: "text", text, version: 1 }],
          direction: "ltr",
          format: "",
          indent: 0,
          version: 1,
        })),
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      version: 1,
    },
  };
}

async function seed() {
  const payload = await getPayload({ config });

  console.log("Clearing existing data...");

  // Delete in reverse-dependency order
  for (const collection of [
    "posts",
    "pages",
    "categories",
    "media",
    "api-keys",
    "users",
  ] as const) {
    const existing = await payload.find({ collection, limit: 0 });
    for (const doc of existing.docs) {
      await payload.delete({ collection, id: doc.id });
    }
  }

  console.log("Seeding database...");

  // Create admin user
  const user = await payload.create({
    collection: "users",
    data: {
      email: "admin@example.com",
      password: "admin123",
      name: "Admin User",
      role: "admin",
    },
  });
  console.log(`Created user: ${user.email}`);

  // Create API key for CLI access
  await payload.create({
    collection: "api-keys",
    data: {
      name: "Development CLI",
      enableAPIKey: true,
      apiKey: "test-api-key-for-development",
    },
  });
  console.log("Created API key: Development CLI");

  // Create media items from seed assets
  const mediaData = [
    { filename: "hero-image.png", alt: "Hero banner image" },
    { filename: "team-photo.png", alt: "Team photo" },
    { filename: "office.png", alt: "Office workspace" },
    { filename: "blog-cover.png", alt: "Blog post cover image" },
    { filename: "product-shot.png", alt: "Product screenshot" },
  ];

  const media: Record<string, Media["id"]> = {};
  for (const item of mediaData) {
    const filePath = join(__dirname, "seed-assets", item.filename);
    const data = readFileSync(filePath);
    const file = {
      name: item.filename,
      data,
      mimetype: "image/png",
      size: data.length,
    };
    const created = await payload.create({
      collection: "media",
      data: { alt: item.alt },
      file,
    });
    media[item.filename.replace(".png", "")] = created.id;
    console.log(`Created media: ${item.alt}`);
  }

  // Create categories
  const categoryData = [
    {
      name: "Technology",
      slug: "technology",
      description: "Posts about tech and software",
    },
    {
      name: "Tutorials",
      slug: "tutorials",
      description: "Step-by-step guides",
    },
    {
      name: "News",
      slug: "news",
      description: "Latest updates and announcements",
    },
  ];

  const categories: Record<string, Category["id"]> = {};
  for (const cat of categoryData) {
    const created = await payload.create({
      collection: "categories",
      data: cat,
    });
    categories[cat.slug] = created.id;
    console.log(`Created category: ${created.name}`);
  }

  // Create home (root) page first
  const homePage = await payload.create({
    collection: "pages",
    draft: true,
    data: {
      title: "Home",
      slug: "",
      isRootPage: true,
      layout: [
        {
          blockType: "hero",
          heading: "Welcome to My Test Site",
          subheading: "A demo site for testing payload-content-cli",
          image: media["hero-image"],
          ctaLabel: "Read the Blog",
          ctaLink: "/blog",
        },
      ],
      meta: {
        title: "Home - My Test Site",
        description: "Welcome to our test site",
      },
    },
  });
  console.log(`Created home page: ${homePage.id}`);

  // Create blog page (child of home, parent for posts)
  const blogPage = await payload.create({
    collection: "pages",
    draft: true,
    data: {
      title: "Blog",
      slug: "blog",
      parent: homePage.id,
      layout: [
        {
          blockType: "hero",
          heading: "Blog",
          subheading: "Latest posts and articles",
        },
      ],
    },
  });
  console.log(`Created blog page: ${blogPage.id}`);

  // Create posts with rich content
  const postData = [
    {
      title: "Hello World",
      slug: "hello-world",
      excerpt: "Welcome to our blog. This is the first post with rich content.",
      content: lexicalWithHeading("Welcome to Our Blog", [
        "This is our very first blog post. We are excited to share our thoughts and experiences with you.",
        "In this blog, we will cover topics ranging from technology to tutorials and everything in between.",
        "Stay tuned for more content coming soon!",
      ]),
      status: "published" as const,
      publishedAt: "2026-01-15T10:00:00.000Z",
      author: user.id,
      categories: [categories["news"]],
      tags: [{ tag: "introduction" }, { tag: "welcome" }],
      featuredImage: media["blog-cover"],
      meta: {
        title: "Hello World - My Test Site",
        description: "Welcome to our blog",
      },
    },
    {
      title: "Getting Started with Payload CMS",
      slug: "getting-started",
      excerpt: "A comprehensive guide to setting up and using Payload CMS v3.",
      content: lexicalWithHeading("Getting Started", [
        "Payload CMS is a powerful headless CMS built with TypeScript and Next.js.",
        "In this tutorial, we will walk through the basics of setting up a Payload project, defining collections, and working with the admin panel.",
        "Payload provides a flexible and developer-friendly approach to content management that scales with your needs.",
      ]),
      status: "published" as const,
      publishedAt: "2026-02-01T10:00:00.000Z",
      author: user.id,
      categories: [categories["tutorials"], categories["technology"]],
      tags: [{ tag: "tutorial" }, { tag: "payload" }, { tag: "cms" }],
      meta: {
        title: "Getting Started with Payload CMS",
        description: "Learn how to use Payload CMS v3",
      },
    },
    {
      title: "Draft Post",
      slug: "draft-post",
      excerpt: "This post is still being worked on.",
      content: lexicalContent([
        "This is a draft post that has not been published yet.",
      ]),
      status: "draft" as const,
      author: user.id,
      categories: [categories["news"]],
      tags: [{ tag: "draft" }],
    },
    {
      title: "Advanced Payload Patterns",
      slug: "advanced-patterns",
      excerpt: "Deep dive into blocks, hooks, and access control in Payload.",
      content: lexicalWithHeading("Advanced Patterns", [
        "Once you have the basics down, Payload offers powerful patterns for building complex applications.",
        "Blocks allow you to create flexible page layouts with reusable components.",
        "Hooks let you run custom logic before or after CRUD operations.",
        "Access control gives you fine-grained permissions at the collection, field, and document level.",
      ]),
      status: "published" as const,
      publishedAt: "2026-03-01T10:00:00.000Z",
      author: user.id,
      categories: [categories["tutorials"], categories["technology"]],
      tags: [{ tag: "advanced" }, { tag: "patterns" }, { tag: "payload" }],
      meta: {
        title: "Advanced Payload Patterns",
        description: "Deep dive into Payload CMS features",
      },
    },
    {
      title: "Working with Relationships",
      slug: "working-with-relationships",
      excerpt: "How to model and query relationships between collections.",
      content: lexicalWithHeading("Relationships in Payload", [
        "Relationships are a core concept in Payload CMS. They allow you to link documents across collections.",
        "You can define one-to-one, one-to-many, and polymorphic relationships.",
        "The depth parameter controls how deeply related documents are populated in API responses.",
      ]),
      status: "published" as const,
      publishedAt: "2026-03-10T10:00:00.000Z",
      author: user.id,
      categories: [categories["tutorials"]],
      tags: [{ tag: "tutorial" }, { tag: "relationships" }],
      meta: {
        title: "Working with Relationships",
        description: "Learn about Payload CMS relationships",
      },
    },
  ];

  const createdPosts: Post["id"][] = [];
  for (const post of postData) {
    const created = await payload.create({
      collection: "posts",
      draft: true,
      data: { ...post, parent: blogPage.id },
    });
    createdPosts.push(created.id);
    console.log(`Created post: ${created.title}`);
  }

  // Add relatedPosts cross-references
  await payload.update({
    collection: "posts",
    id: createdPosts[0],
    data: { relatedPosts: [createdPosts[1], createdPosts[3]] },
  });
  await payload.update({
    collection: "posts",
    id: createdPosts[1],
    data: { relatedPosts: [createdPosts[3], createdPosts[4]] },
  });
  await payload.update({
    collection: "posts",
    id: createdPosts[3],
    data: { relatedPosts: [createdPosts[1], createdPosts[4]] },
  });

  // Add German translations for first two posts
  await payload.update({
    collection: "posts",
    id: createdPosts[0],
    locale: "de",
    data: {
      title: "Hallo Welt",
      slug: "hallo-welt",
      excerpt:
        "Willkommen in unserem Blog. Dies ist der erste Beitrag mit reichem Inhalt.",
      content: lexicalWithHeading("Willkommen in unserem Blog", [
        "Dies ist unser allererster Blogbeitrag. Wir freuen uns, unsere Gedanken und Erfahrungen mit Ihnen zu teilen.",
        "In diesem Blog werden wir Themen von Technologie bis hin zu Tutorials und alles dazwischen behandeln.",
      ]),
    },
  });
  await payload.update({
    collection: "posts",
    id: createdPosts[1],
    locale: "de",
    data: {
      title: "Erste Schritte mit Payload CMS",
      slug: "erste-schritte",
      excerpt:
        "Ein umfassender Leitfaden zur Einrichtung und Nutzung von Payload CMS v3.",
      content: lexicalWithHeading("Erste Schritte", [
        "Payload CMS ist ein leistungsstarkes Headless CMS, das mit TypeScript und Next.js erstellt wurde.",
        "In diesem Tutorial werden wir die Grundlagen der Einrichtung eines Payload-Projekts durchgehen.",
      ]),
    },
  });
  console.log("Added German translations for 2 posts");

  // Create child pages (all children of Home)
  const pageData: Array<Partial<Page>> = [
    {
      title: "About Us",
      slug: "about",
      parent: homePage.id,
      layout: [
        {
          blockType: "hero",
          heading: "About Us",
          subheading: "Learn more about our mission and team.",
          image: media["team-photo"],
        },
        {
          blockType: "content",
          richText: lexicalWithHeading("Our Mission", [
            "We believe AI agents should work with content the same way developers do — through files.",
            "payload-content-cli bridges the gap between your CMS and your development workflow.",
          ]),
        },
      ],
      meta: {
        title: "About Us - My Test Site",
        description: "Learn about our mission",
      },
    },
    {
      title: "Contact",
      slug: "contact",
      parent: homePage.id,
      layout: [
        {
          blockType: "hero",
          heading: "Get in Touch",
          subheading: "We would love to hear from you.",
        },
        {
          blockType: "content",
          richText: lexicalContent([
            "You can reach us via email at hello@example.com or through our GitHub repository.",
            "We are always looking for feedback and contributions.",
          ]),
        },
      ],
      meta: {
        title: "Contact - My Test Site",
        description: "Get in touch with us",
      },
    },
    {
      title: "Privacy Policy",
      slug: "privacy-policy",
      parent: homePage.id,
      layout: [
        {
          blockType: "content",
          richText: lexicalWithHeading("Privacy Policy", [
            "This is a sample privacy policy for testing purposes.",
            "Your data is handled in accordance with applicable regulations.",
            "We do not sell or share your personal information with third parties.",
          ]),
        },
      ],
    },
    {
      title: "Terms of Service",
      slug: "terms-of-service",
      parent: homePage.id,

      layout: [
        {
          blockType: "content",
          richText: lexicalWithHeading("Terms of Service", [
            "By using this site, you agree to the following terms and conditions.",
            "This content is provided as-is for demonstration purposes only.",
          ]),
        },
      ],
    },
  ];

  for (const page of pageData) {
    const created = await payload.create({
      collection: "pages",
      draft: true,
      data: page,
    });
    console.log(`Created page: ${created.title}`);
  }

  // Update global
  await payload.updateGlobal({
    slug: "site-settings",
    data: {
      siteName: "My Test Site",
      siteDescription: "A test site for payload-content-cli development",
      navigation: [
        { label: "Home", url: "/" },
        { label: "Blog", url: "/blog" },
        { label: "About", url: "/about" },
        { label: "Contact", url: "/contact" },
      ],
    },
  });
  console.log("Updated site-settings global");

  console.log("\nSeed complete!");
  console.log(`  ${Object.keys(media).length} media items`);
  console.log(`  ${Object.keys(categories).length} categories`);
  console.log(`  ${createdPosts.length} posts (with cross-references)`);
  console.log(`  ${pageData.length} pages (with blocks layout)`);
  console.log(`  1 global (site-settings)`);
  console.log("\nAdmin login: admin@example.com / admin123");
  console.log("API key: test-api-key-for-development (collection: api-keys)");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  if (err.data?.errors) {
    console.error(
      "Validation errors:",
      JSON.stringify(err.data.errors, null, 2),
    );
  }
  process.exit(1);
});
