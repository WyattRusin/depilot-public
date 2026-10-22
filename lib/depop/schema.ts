import { DEPOP_CONDITIONS, DEPOP_COLORS, DEPOP_SOURCES, DEPOP_STYLES, DEPOP_CATEGORY_GROUPS } from './data.ts';
import { DATING_ERAS, DATING_CONFIDENCES } from './dating.ts';
import { PHOTO_ROLES } from '../pricing/arrange.ts';

const S = { type: 'STRING' };
const LIST = { type: 'ARRAY', items: S };

export function buildListingSchema() {
  return {
    type: 'OBJECT',
    properties: {
      photos: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { photo: { type: 'INTEGER' }, role: { type: 'STRING', enum: [...PHOTO_ROLES] }, fullItem: { type: 'BOOLEAN' } },
          required: ['photo', 'role', 'fullItem'],
          propertyOrdering: ['photo', 'role', 'fullItem'],
        },
      },
      evidence: LIST,
      tagText: S,
      tagLegibility: { type: 'STRING', enum: ['clear', 'partial', 'unreadable', 'not_pictured'] },
      notVisible: LIST,
      flaws: LIST,
      measurements: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: S,
            value: S,
            unit: { type: 'STRING', enum: ['in', 'cm'] },
            readFrom: S,
          },
          required: ['name', 'value', 'unit', 'readFrom'],
          propertyOrdering: ['readFrom', 'name', 'value', 'unit'],
        },
      },
      dating: {
        type: 'OBJECT',
        properties: {
          era: { type: 'STRING', enum: DATING_ERAS },
          confidence: { type: 'STRING', enum: [...DATING_CONFIDENCES] },
          basis: LIST,
        },
        required: ['era', 'confidence', 'basis'],
        propertyOrdering: ['era', 'confidence', 'basis'],
      },
      itemType: S,
      searchQuery: S,
      broadQuery: S,
      title: S,
      opener: S,
      details: LIST,
      fit: S,
      conditionNote: S,
      styling: S,
      tags: LIST,
      condition: { type: 'STRING', enum: DEPOP_CONDITIONS },
      categoryGroup: { type: 'STRING', enum: DEPOP_CATEGORY_GROUPS },
      brand: S,
      model: S,
      size: S,
      color1: { type: 'STRING', enum: DEPOP_COLORS },
      color2: { type: 'STRING', enum: DEPOP_COLORS },
      source1: { type: 'STRING', enum: DEPOP_SOURCES },
      source2: { type: 'STRING', enum: DEPOP_SOURCES },
      style1: { type: 'STRING', enum: DEPOP_STYLES },
      style2: { type: 'STRING', enum: DEPOP_STYLES },
      style3: { type: 'STRING', enum: DEPOP_STYLES },
      suggestedPrice: { type: 'NUMBER' },
    },
    required: [
      'photos', 'evidence', 'tagText', 'tagLegibility', 'notVisible', 'flaws', 'measurements', 'dating',
      'itemType', 'searchQuery', 'broadQuery',
      'title', 'opener', 'details', 'fit', 'conditionNote', 'tags',
      'condition', 'categoryGroup', 'brand', 'size', 'color1', 'style1', 'suggestedPrice',
    ],
    propertyOrdering: [
      'photos', 'evidence', 'tagText', 'tagLegibility', 'notVisible', 'flaws', 'measurements', 'dating',
      'itemType', 'searchQuery', 'broadQuery',
      'title', 'opener', 'details', 'fit', 'conditionNote', 'styling', 'tags',
      'condition', 'categoryGroup', 'brand', 'model', 'size', 'color1', 'color2',
      'source1', 'source2', 'style1', 'style2', 'style3', 'suggestedPrice',
    ],
  };
}

export interface ModelListing {
  photos: { photo: number; role: string; fullItem: boolean }[];
  evidence: string[]; tagText: string; tagLegibility: 'clear' | 'partial' | 'unreadable' | 'not_pictured';
  notVisible: string[]; flaws: string[];
  measurements: { name: string; value: string; unit: 'in' | 'cm'; readFrom: string }[];
  dating: { era: string; confidence: string; basis: string[] };
  itemType: string; searchQuery: string; broadQuery: string;
  title: string; opener: string; details: string[]; fit: string; conditionNote: string;
  styling?: string; tags: string[];
  condition: string; categoryGroup: string; brand: string; model?: string; size: string;
  color1: string; color2?: string; source1?: string; source2?: string;
  style1: string; style2?: string; style3?: string; suggestedPrice: number;
}
