/* This is a script to create a new post markdown file with front-matter */

import fs from "fs"
import path from "path"

function getDate() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error(`Error: No filename argument provided
Usage: pnpm new-post <slug>`)
  process.exit(1) // Terminate the script and return error code 1
}

// A post is a folder with index.mdx (new posts are MDX; older index.md posts still build).
const slug = args[0].replace(/\/?(index)?\.mdx?$/i, "")
const fullPath = path.join("./src/content/posts/", slug, "index.mdx")

if (fs.existsSync(path.dirname(fullPath))) {
  console.error(`Error: ${path.dirname(fullPath)} already exists`)
  process.exit(1)
}
fs.mkdirSync(path.dirname(fullPath), { recursive: true })

const content = `---
title: ${slug}
published: ${getDate()}
description: ''
image: ''
tags: []
category: ''
draft: false 
lang: ''
---
`

fs.writeFileSync(fullPath, content)

console.log(`Post ${fullPath} created`)
