package dummy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/gridfs"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Mongo menyimpan rekaman dummy di MongoDB: file .npz utuh di GridFS bucket
// "dummy" (satu file bisa >16 MB, batas satu dokumen), info per rekaman di
// collection dummy_recordings, dan ringkasan ground_truth.json di dummy_meta.
type Mongo struct {
	recs   *mongo.Collection
	meta   *mongo.Collection
	bucket *gridfs.Bucket
}

const groundTruthID = "ground_truth"

func NewMongo(db *mongo.Database) (*Mongo, error) {
	b, err := gridfs.NewBucket(db, options.GridFSBucket().SetName("dummy"))
	if err != nil {
		return nil, err
	}
	return &Mongo{recs: db.Collection("dummy_recordings"), meta: db.Collection("dummy_meta"), bucket: b}, nil
}

type recordDoc struct {
	File       string    `bson:"_id"`
	LevelDB    *int      `bson:"level_db"`
	Fs         float64   `bson:"fs"`
	Sweeps     int       `bson:"sweeps"`
	DurationS  float64   `bson:"duration_s"`
	Size       int       `bson:"size"`
	UploadedAt time.Time `bson:"uploaded_at"`
}

// gtSummary = keluaran `dummy_npz.py --gt` (level sebagai string, kunci JSON).
type gtSummary struct {
	ThresholdDB *int                       `json:"threshold_db"`
	Levels      map[string]json.RawMessage `json:"levels"`
}

func (m *Mongo) catalog(ctx context.Context) (*Catalog, error) {
	cur, err := m.recs.Find(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	var docs []recordDoc
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	var gt gtSummary
	var meta struct {
		JSON string `bson:"json"`
	}
	if err := m.meta.FindOne(ctx, bson.M{"_id": groundTruthID}).Decode(&meta); err == nil {
		_ = json.Unmarshal([]byte(meta.JSON), &gt)
	} else if err != mongo.ErrNoDocuments {
		return nil, err
	}

	c := &Catalog{Dir: "mongodb (gridfs: dummy)", ThresholdDB: gt.ThresholdDB, Recordings: make([]Recording, 0, len(docs))}
	for _, d := range docs {
		r := Recording{File: d.File, LevelDB: d.LevelDB, Fs: d.Fs, Sweeps: d.Sweeps, DurationS: d.DurationS, Storage: StorageMongo}
		if d.LevelDB != nil {
			r.GroundTruth = gt.Levels[strconv.Itoa(*d.LevelDB)]
		}
		c.Recordings = append(c.Recordings, r)
	}
	sort.Slice(c.Recordings, func(i, j int) bool { return level(c.Recordings[i]) > level(c.Recordings[j]) })
	return c, nil
}

func level(r Recording) int {
	if r.LevelDB == nil {
		return 0
	}
	return *r.LevelDB
}

func (m *Mongo) open(file string) ([]byte, error) {
	var buf bytes.Buffer
	if _, err := m.bucket.DownloadToStreamByName(file, &buf); err != nil {
		return nil, fmt.Errorf("gridfs %s: %w", file, err)
	}
	return buf.Bytes(), nil
}

// putRecording mengganti file dengan nama yang sama (GridFS mengizinkan duplikat nama).
func (m *Mongo) putRecording(ctx context.Context, r Recording, data []byte) error {
	if err := m.deleteFiles(ctx, r.File); err != nil {
		return err
	}
	if _, err := m.bucket.UploadFromStream(r.File, bytes.NewReader(data)); err != nil {
		return err
	}
	doc := recordDoc{File: r.File, LevelDB: r.LevelDB, Fs: r.Fs, Sweeps: r.Sweeps, DurationS: r.DurationS,
		Size: len(data), UploadedAt: time.Now()}
	_, err := m.recs.ReplaceOne(ctx, bson.M{"_id": r.File}, doc, options.Replace().SetUpsert(true))
	return err
}

func (m *Mongo) putGroundTruth(ctx context.Context, summary []byte) error {
	_, err := m.meta.ReplaceOne(ctx, bson.M{"_id": groundTruthID},
		bson.M{"json": string(summary), "uploaded_at": time.Now()}, options.Replace().SetUpsert(true))
	return err
}

func (m *Mongo) deleteFiles(ctx context.Context, name string) error {
	cur, err := m.bucket.FindContext(ctx, bson.M{"filename": name})
	if err != nil {
		return err
	}
	var files []struct {
		ID any `bson:"_id"`
	}
	if err := cur.All(ctx, &files); err != nil {
		return err
	}
	for _, f := range files {
		if err := m.bucket.DeleteContext(ctx, f.ID); err != nil {
			return err
		}
	}
	return nil
}
