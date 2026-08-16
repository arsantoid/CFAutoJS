@echo off
color 0A
title Cloudflare Auto Creator
cd /d "%~dp0"

echo =======================================================
echo            CLOUDFLARE AUTO CREATOR BOT
echo =======================================================
echo.

node cloudflareAuto.js
