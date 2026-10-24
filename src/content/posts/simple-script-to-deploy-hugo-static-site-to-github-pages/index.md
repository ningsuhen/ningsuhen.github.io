---
title: Simple script to deploy hugo static site to github pages
published: 2015-11-05
description: "A small rsync-based script to build a Hugo site and deploy it to GitHub Pages in one step."
image: ./cover.png
thumbnail: ./thumb.webp
tags: [hugo, github pages, deploy, static site]
category: Dev Automation
draft: false
---

Hugo is an awesome Static Site generator written in Go and this blog is powered by Hugo. If you are familiar with Jekyll or Octopress, Hugo is a similar tool in Golang but much faster and better. Well, that's something people like to debate but let's come to the point. I was evaluating hugo for the first time and I really liked it. I configured my project and I was ready to deploy it to Github Pages. However, the instructions at https://gohugo.io/tutorials/github-pages-blog/ were too much of a pain for me and didn't work at all. So, I developed a small script which is quite simple and works flawlessly although it uses `rsync`. If you don't have `rsync`, make sure you have it installed.

## Step #1 - Setup Source Project

[Setup your source project](https://gohugo.io/overview/quickstart/) with

```bash
hugo new site /path/to/project
```

and generate your static site with

```bash
cd /path/to/project
hugo -d public
```

If you don't use `public` as output for generating the static, you have to make changes in the deploy script.

## Step #2 - Setup Distribution Folder

It would have been great if we can just push the content from public folder to github but hugo cleans the whole directory including .git files. So, we are going to copy the contents of `public` folder into a folder called `dist`

```bash
mkdir dist
git remote add [git repo url ] # e.g. git@github.com:devhacks/devhacks.github.io.git
#git checkout master # since this is an organizational site, we deploy the site to master. If it's a project site, checkout gh-pages instead
```

## Step #3 - Download Deploy Script

You can download the deploy script with

```bash
wget https://gist.githubusercontent.com/ningsuhen/b544f17d31160890d774/raw/deploy.sh
```

or create a new file deploy.sh with the following content.

```bash title="deploy.sh"
#!/usr/bin/env bash -xe


#allow passing a commit message
message=$1

if [ "$message" == "" ]; then
  #use last git commit message for deploying into github pages
  message=`git log -1 --pretty=%B`
fi

#generate static site into public & copy files into dist folder
hugo -d public
rsync -avh --delete public/* dist/

# push the files into github pages
cd dist
git add .
git commit -m "$message"
git push origin master #replace "master" with "gh-pages" if you are deploying into a project site

# go back to source directory
cd -
```

Original gist: https://gist.github.com/ningsuhen/b544f17d31160890d774

## Step #4 - Deploy

Now, you can deploy your static site easily after every change by running

```bash
./deploy.sh
```

The script will generate the latest static files and push it to github pages. In short, no more multiple git commands to execute everytime.

## Bonus - Integrate with git pre-push

You can even call the deploy script from git pre-push hook on the source branch. With this, you don't have to run the deploy script everytime. All you have to do is commit and push the source project.

File *`.git/hooks/pre-push`*

```bash
#!/bin/sh

./deploy.sh
```
