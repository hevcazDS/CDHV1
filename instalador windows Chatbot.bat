@echo off
title Instalador Windows - Chatbot
:: Lanza el script real en PowerShell, a la vista (sin -WindowStyle Hidden
:: ni -EncodedCommand) para que no se vea como el patron tipico que marcan
:: los antivirus. -ExecutionPolicy Bypass aplica SOLO a esta ejecucion, no
:: cambia la politica del sistema.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalador-windows-chatbot.ps1"
