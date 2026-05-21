package main

import (
	"capstone/internal/abr"
	"capstone/api"
	"fmt"
	"log"
	"os"
)

func main() {
	// Subcommand: ./server analyze <file.json>
	if len(os.Args) > 1 && os.Args[1] == "analyze" {
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Usage: server analyze <file.json>")
			os.Exit(1)
		}
		if err := abr.Analyze(os.Args[2]); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		return
	}

	cfg := abr.DefaultConfig()
	srv := api.New(cfg)

	addr := ":8080"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}

	mode := "ADS1299 (8-channel)"
	if cfg.ADS1115Mode {
		mode = "ADS1115 (single-channel, 860 Hz override)"
	}

	log.Printf("=== EEG Capstone Backend ===")
	log.Printf("Mode          : %s", mode)
	log.Printf("Sampling rate : %.0f Hz", cfg.SamplingRate)
	log.Printf("Epoch         : %.0f ms", cfg.EpochMs)
	log.Printf("Max trials    : %d", cfg.MaxTrials)
	log.Printf("")
	log.Printf("WebSocket     : ws://localhost%s/ws?id=<device_id>", addr)
	log.Printf("Health        : GET  http://localhost%s/api/v1/health", addr)
	log.Printf("Devices       : GET  http://localhost%s/api/v1/devices", addr)
	log.Printf("ABR result    : GET  http://localhost%s/api/v1/abr", addr)
	log.Printf("ABR stream    : GET  http://localhost%s/api/v1/abr/stream  (SSE)", addr)
	log.Printf("ABR save      : POST http://localhost%s/api/v1/abr/save", addr)
	log.Printf("Stim trigger  : POST http://localhost%s/api/v1/stim", addr)
	log.Printf("Stim set dB   : POST http://localhost%s/api/v1/stim/set  {\"db\":80}", addr)
	log.Printf("Broadcast     : POST http://localhost%s/api/v1/broadcast  {\"msg\":\"...\"}", addr)
	log.Printf("===========================")
	log.Fatal(srv.Listen(addr))
}
