[English](../README.md)

# Installare Netfish

Netfish è fatto di due parti:

1. **Il server**, che gira accanto a Jellyfin (di solito su un Raspberry Pi con Portainer). Lo configuri una volta sola: **[Guida al server](server.md)**.
2. **Le app** con cui guardi. Ogni app ha bisogno solo dell'indirizzo del tuo server (per esempio `192.168.1.50`); l'interfaccia, il tuo account e le tue impostazioni arrivano tutti dal server.

| Dispositivo | Guida | Difficoltà |
|---|---|---|
| Qualsiasi browser | Apri `http://<your-server>:7777` | Niente da installare |
| Mac con chip Apple | [Mac](mac.md) | Facile |
| Windows 10/11 | [Windows](windows.md) | Facile |
| Telefono o tablet Android | [Android](android.md) | Facile |
| Amazon Fire TV / Fire Stick, Android TV, Google TV | [Fire TV e Android TV](fire-tv.md) | Qualche impostazione da cambiare una volta |
| iPhone e iPad | [iPhone e iPad](iphone-ipad.md) | Serve un Mac, oppure usa la versione per browser |
| TV Samsung (2022 o più recente) | [TV Samsung](samsung-tv.md) | Servono un computer e un po' di pazienza |

Tutti i file da scaricare sono nella [pagina Releases](https://github.com/ravifrancesco/netfish/releases/latest). I link in queste guide portano sempre alla versione più recente.

**Come trovare l'indirizzo del tuo server:** è l'indirizzo con cui apri Netfish nel browser. Sul Pi, il comando `hostname -I` lo mostra (è il primo numero, tipo `192.168.1.50`). La porta `:7777` la aggiunge Netfish da solo.
