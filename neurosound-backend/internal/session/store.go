package session

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Store struct {
	client *mongo.Client
	coll   *mongo.Collection
	dir    string
}

func NewStore(ctx context.Context, mongoURI, dbName, dir string) (*Store, error) {
	if dir == "" {
		dir = "data/sessions"
	}
	_ = os.MkdirAll(dir, 0o755)

	s := &Store{dir: dir}
	if mongoURI == "" {
		return s, nil
	}
	if dbName == "" {
		dbName = "neurosound"
	}
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}
	s.client = client
	s.coll = client.Database(dbName).Collection("sessions")
	_, _ = s.coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "filename", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	return s, nil
}

func (s *Store) Close(ctx context.Context) error {
	if s.client == nil {
		return nil
	}
	return s.client.Disconnect(ctx)
}

func (s *Store) Save(ctx context.Context, doc Document) error {
	if doc.Filename == "" {
		doc.Filename = "eeg_abr_" + time.Now().Format("20060102_150405") + ".json"
	}
	if doc.SavedAt.IsZero() {
		doc.SavedAt = time.Now()
	}
	if s.coll != nil {
		_, err := s.coll.UpdateOne(
			ctx,
			bson.M{"filename": doc.Filename},
			bson.M{"$set": doc},
			options.Update().SetUpsert(true),
		)
		if err != nil {
			return err
		}
	}
	return s.saveFile(doc)
}

func (s *Store) List(ctx context.Context) ([]Meta, error) {
	if s.coll != nil {
		cur, err := s.coll.Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "saved_at", Value: -1}}))
		if err != nil {
			return nil, err
		}
		defer cur.Close(ctx)
		var docs []Document
		if err := cur.All(ctx, &docs); err != nil {
			return nil, err
		}
		return metas(docs), nil
	}
	return s.listFiles()
}

func (s *Store) Get(ctx context.Context, filename string) (*Document, error) {
	filename = filepath.Base(filename)
	if s.coll != nil {
		var doc Document
		err := s.coll.FindOne(ctx, bson.M{"filename": filename}).Decode(&doc)
		if err == nil {
			return &doc, nil
		}
		if !errors.Is(err, mongo.ErrNoDocuments) {
			return nil, err
		}
	}
	return s.getFile(filename)
}

func (s *Store) saveFile(doc Document) error {
	path := filepath.Join(s.dir, filepath.Base(doc.Filename))
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(doc)
}

func (s *Store) listFiles() ([]Meta, error) {
	matches, err := filepath.Glob(filepath.Join(s.dir, "eeg_abr_*.json"))
	if err != nil {
		return nil, err
	}
	docs := make([]Document, 0, len(matches))
	for _, path := range matches {
		doc, err := s.getFile(filepath.Base(path))
		if err == nil {
			docs = append(docs, *doc)
		}
	}
	sort.Slice(docs, func(i, j int) bool { return docs[i].SavedAt.After(docs[j].SavedAt) })
	return metas(docs), nil
}

func (s *Store) getFile(filename string) (*Document, error) {
	if !strings.HasPrefix(filename, "eeg_abr_") || !strings.HasSuffix(filename, ".json") {
		return nil, os.ErrNotExist
	}
	data, err := os.ReadFile(filepath.Join(s.dir, filepath.Base(filename)))
	if err != nil {
		return nil, err
	}
	var doc Document
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, err
	}
	return &doc, nil
}

func metas(docs []Document) []Meta {
	out := make([]Meta, len(docs))
	for i, d := range docs {
		out[i] = Meta{
			Filename:   d.Filename,
			SavedAt:    d.SavedAt,
			TrialCount: d.TrialCount,
			Status:     d.Status,
			SNR:        d.SNR,
			Verdict:    d.Analysis.Verdict,
		}
	}
	return out
}
