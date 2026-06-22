@echo off
title Instalador Windows - Chatbot (Asistente grafico)
:: Lanza el asistente grafico paso a paso. Mismo criterio anti-falso-positivo
:: que "instalador windows Chatbot.bat": -ExecutionPolicy Bypass aplica SOLO
:: a esta ejecucion, sin ventana oculta ni comando codificado.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalador-windows-wizard.ps1"
