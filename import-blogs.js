import fs from 'fs';
import path from 'path';

// 1. Read Env configurations
const featureEnvPath = './.env';
let supabaseUrl = '';
let supabaseKey = '';

if (fs.existsSync(featureEnvPath)) {
  const envContent = fs.readFileSync(featureEnvPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_URL=')) {
      supabaseUrl = line.split('=')[1].trim().replace(/['"]/g, '');
    }
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
      supabaseKey = line.split('=')[1].trim().replace(/['"]/g, '');
    }
    if (!supabaseKey && line.startsWith('SUPABASE_ANON_KEY=')) {
      supabaseKey = line.split('=')[1].trim().replace(/['"]/g, '');
    }
  }
}

const args = process.argv.slice(2);
let projectId = args[0];

if (!projectId) {
  const rootEnvPath = '../.env';
  if (fs.existsSync(rootEnvPath)) {
    const envContent = fs.readFileSync(rootEnvPath, 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      if (line.startsWith('VITE_BLOG_PROJECT_ID=')) {
        projectId = line.split('=')[1].trim().replace(/['"]/g, '');
      }
    }
  }
}

if (!projectId) {
  projectId = '895ecc14-ae41-4fe8-9f2d-51072a3c44c9'; // Fallback to root .env value
}

console.log("Supabase URL:", supabaseUrl);
console.log("Target Project ID:", projectId);

async function run() {
  try {
    // 2. Ensure project exists
    const projCheckRes = await fetch(`${supabaseUrl}/rest/v1/projects?id=eq.${projectId}`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    
    if (!projCheckRes.ok) {
      console.error("Failed to check project existence:", projCheckRes.status, await projCheckRes.text());
      return;
    }
    
    const projects = await projCheckRes.json();
    if (projects.length === 0) {
      console.log(`Project ${projectId} not found in database. Creating it...`);
      const projCreateRes = await fetch(`${supabaseUrl}/rest/v1/projects`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          id: projectId,
          name: 'Certifyied'
        })
      });
      if (!projCreateRes.ok) {
        console.error("Failed to create project:", projCreateRes.status, await projCreateRes.text());
        return;
      }
      console.log("Project created successfully!");
    } else {
      console.log(`Project ${projectId} ("${projects[0].name}") already exists.`);
    }

    // 3. Load migrated blogs
    const migratedBlogsPath = './migrated_blogs.json';
    if (!fs.existsSync(migratedBlogsPath)) {
      console.error("migrated_blogs.json not found!");
      return;
    }
    
    const blogs = JSON.parse(fs.readFileSync(migratedBlogsPath, 'utf8'));
    console.log(`Found ${blogs.length} blogs to import.`);

    // 4. Batch upsert blogs (using REST upsert)
    // PostgREST supports upsert with POST and header Prefer: resolution=merge-duplicates or ON CONFLICT resolution
    const blogsPayload = blogs.map(b => ({
      readable_id: b.id,
      project_id: projectId,
      title: b.title,
      subtitle: b.subtitle,
      main_image_url: b.main_image_url,
      paragraphs: b.paragraphs,
      slug: b.slug,
      updated_at: new Date().toISOString()
    }));

    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/blogs?on_conflict=project_id,slug`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(blogsPayload)
    });

    if (!upsertRes.ok) {
      console.error("Upsert failed:", upsertRes.status, await upsertRes.text());
      return;
    }

    console.log(`Successfully imported all ${blogs.length} blogs into the database!`);
  } catch (err) {
    console.error("Error during import:", err);
  }
}

run();
