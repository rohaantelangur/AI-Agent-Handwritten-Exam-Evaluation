export type BBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
};

export type NormalizedBBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type EvidenceRegion = {
  page_number: number;
  bbox: BBox | null;
  normalized_bbox: NormalizedBBox | null;
  s3_key?: string;
  coordinate_source: "layout" | "crop" | "unavailable";
};

export type PageImage = {
  page_number: number;
  width: number;
  height: number;
  dpi: number;
  localPath: string;
  s3_key?: string;
};

export type S3ObjectRef = {
  bucket: string;
  key: string;
  temporary_url?: string;
};
