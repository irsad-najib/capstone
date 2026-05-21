package api

import (
	"bufio"
	"capstone/internal/abr"
	"encoding/json"
	"fmt"
	"time"

	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

// Server membungkus Fiber app dan dependensinya.
type Server struct {
	app  *fiber.App
	hub  *Hub
	proc *abr.Processor
}

// New membuat Server baru dengan semua route terdaftar.
func New(cfg abr.Config) *Server {
	proc := abr.NewProcessor(cfg)
	hub := newHub(proc)

	app := fiber.New(fiber.Config{
		AppName:      "EEG Capstone API v1",
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	})

	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "[${time}] ${status} ${method} ${path} ${latency}\n",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	app.Static("/", "./static")

	s := &Server{app: app, hub: hub, proc: proc}
	s.registerRoutes()
	return s
}

func (s *Server) Listen(addr string) error {
	return s.app.Listen(addr)
}

func (s *Server) registerRoutes() {
	// WebSocket upgrade guard
	s.app.Use("/ws", func(c *fiber.Ctx) error {
		if fiberws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	// WebSocket — ESP32 connects here
	s.app.Get("/ws", fiberws.New(s.hub.wsHandler))

	// REST API
	v1 := s.app.Group("/api/v1")
	v1.Get("/health", s.handleHealth)
	v1.Get("/devices", s.handleDevices)
	v1.Post("/broadcast", s.handleBroadcast)
	v1.Get("/abr", s.handleABRResult)
	v1.Get("/abr/stream", s.handleABRStream)
	v1.Get("/raw/stream", s.handleRawStream)
	v1.Post("/abr/save", s.handleABRSave)
	v1.Post("/stim", s.handleStimTrigger)
	v1.Post("/stim/set", s.handleStimSet)
}

// ── Handlers ──────────────────────────────────────────────────

func (s *Server) handleHealth(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	})
}

func (s *Server) handleDevices(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"devices": s.hub.ConnectedDevices(),
	})
}

func (s *Server) handleBroadcast(c *fiber.Ctx) error {
	var body struct {
		Msg string `json:"msg"`
	}
	// Coba JSON body dulu, fallback ke query param
	if err := c.BodyParser(&body); err != nil || body.Msg == "" {
		body.Msg = c.Query("msg")
	}
	if body.Msg == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "field 'msg' wajib diisi",
		})
	}
	payload, _ := json.Marshal(fiber.Map{
		"type": "command",
		"cmd":  body.Msg,
		"time": time.Now().Format(time.RFC3339),
	})
	s.hub.Broadcast(string(payload))
	return c.JSON(fiber.Map{"ok": true, "msg": body.Msg})
}

func (s *Server) handleABRResult(c *fiber.Ctx) error {
	return c.JSON(s.proc.Result())
}

func (s *Server) handleABRSave(c *fiber.Ctx) error {
	filename := fmt.Sprintf("eeg_abr_%d.json", time.Now().Unix())
	if err := s.proc.SaveJSON(filename); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}
	return c.JSON(fiber.Map{"ok": true, "file": filename})
}

func (s *Server) handleStimTrigger(c *fiber.Ctx) error {
	s.proc.LogStimulus(time.Now())
	return c.JSON(fiber.Map{
		"ok":     true,
		"trials": s.proc.Result().TrialCount,
	})
}

func (s *Server) handleStimSet(c *fiber.Ctx) error {
	var body struct {
		DB int `json:"db"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "field 'db' wajib diisi",
		})
	}
	payload, _ := json.Marshal(fiber.Map{
		"cmd":   "set_db",
		"value": body.DB,
	})
	s.hub.Broadcast(string(payload))
	return c.JSON(fiber.Map{"ok": true, "db": body.DB})
}

func (s *Server) handleRawStream(c *fiber.Ctx) error {
	windowMs := float64(500) // default 500ms window
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			data, _ := json.Marshal(s.proc.RecentSamples(windowMs))
			fmt.Fprintf(w, "data: %s\n\n", data)
			if err := w.Flush(); err != nil {
				return
			}
		}
	})
	return nil
}

func (s *Server) handleABRStream(c *fiber.Ctx) error {
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			data, _ := json.Marshal(s.proc.Result())
			fmt.Fprintf(w, "data: %s\n\n", data)
			if err := w.Flush(); err != nil {
				return
			}
		}
	})
	return nil
}
