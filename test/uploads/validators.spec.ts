import { parse, safeParse } from 'valibot';
import { describe, expect, it } from 'vitest';
import { fileNameWithExtension, sanitizedFileName } from '../../src/uploads/validators.js';

describe('sanitizedFileName', () => {
  const allowedImageExtensions = ['.jpg', '.jpeg', '.png', '.webp'] as const;

  describe('validation', () => {
    it('should accept valid file with allowed extension', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, 'photo.jpg');
      expect(result).toBe('photo.jpg');
    });

    it('should accept file with uppercase extension', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, 'photo.JPG');
      expect(result).toBe('photo.jpg');
    });

    it('should reject file with disallowed extension', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = safeParse(schema, 'document.pdf');
      expect(result.success).toBe(false);
    });

    it('should reject file without extension', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = safeParse(schema, 'filename');
      expect(result.success).toBe(false);
    });

    it('should reject file ending with dot', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = safeParse(schema, 'filename.');
      expect(result.success).toBe(false);
    });

    it('should accept double extension if allowed', () => {
      const schema = sanitizedFileName(['.tar.gz', '.zip']);
      const result = parse(schema, 'archive.tar.gz');
      expect(result).toBe('archive.tar.gz');
    });

    it('should fall back to single extension if double extension is not in allowed list', () => {
      const schema = sanitizedFileName(['.gz', '.zip']);
      const result = parse(schema, 'archive.tar.gz');
      expect(result).toBe('archive-tar.gz');
    });
  });

  describe('sanitization', () => {
    it('should convert filename to lowercase', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, 'MyPhoto.PNG');
      expect(result).toBe('myphoto.png');
    });

    it('should replace spaces with hyphens', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, 'my photo.jpg');
      expect(result).toBe('my-photo.jpg');
    });

    it('should replace special characters with hyphens', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, 'photo (1).jpg');
      expect(result).toBe('photo-1.jpg');
    });

    it('should remove leading and trailing hyphens', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, '---photo---.jpg');
      expect(result).toBe('photo.jpg');
    });

    it('should collapse multiple hyphens', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, 'my   photo.jpg');
      expect(result).toBe('my-photo.jpg');
    });

    it('should remove diacritics', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      expect(parse(schema, 'étudiant.jpg')).toBe('etudiant.jpg');
      expect(parse(schema, 'Crème Brûlée.jpg')).toBe('creme-brulee.jpg');
      expect(parse(schema, 'Åland.jpg')).toBe('aland.jpg');
      expect(parse(schema, 'ñu.jpg')).toBe('nu.jpg');
    });

    it('should handle complex filenames', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, 'My Photo (Copy 2) [Final].PNG');
      expect(result).toBe('my-photo-copy-2-final.png');
    });

    it('should use "file" for empty base name after sanitization', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, '---!!!---.jpg');
      expect(result).toBe('file.jpg');
    });

    it('should preserve alphanumeric characters', () => {
      const schema = sanitizedFileName(allowedImageExtensions);
      const result = parse(schema, 'photo123.jpg');
      expect(result).toBe('photo123.jpg');
    });
  });

  describe('custom error message', () => {
    it('should use custom error message', () => {
      const schema = sanitizedFileName(['.pdf'], 'Only PDFs allowed');
      const result = safeParse(schema, 'file.txt');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues[0].message).toBe('Only PDFs allowed');
      }
    });

    it('should use default error message', () => {
      const schema = sanitizedFileName(['.pdf']);
      const result = safeParse(schema, 'file.txt');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues[0].message).toContain('.pdf');
      }
    });
  });

  describe('different extension sets', () => {
    it('should work with document extensions', () => {
      const schema = sanitizedFileName(['.pdf', '.docx', '.xlsx']);
      expect(parse(schema, 'document.pdf')).toBe('document.pdf');
      expect(parse(schema, 'spreadsheet.xlsx')).toBe('spreadsheet.xlsx');
    });

    it('should work with single extension', () => {
      const schema = sanitizedFileName(['.csv']);
      expect(parse(schema, 'data.csv')).toBe('data.csv');
    });
  });
});

describe('fileNameWithExtension', () => {
  const allowedExtensions = ['.jpg', '.png', '.pdf'] as const;

  describe('validation', () => {
    it('should accept valid file with allowed extension', () => {
      const schema = fileNameWithExtension(allowedExtensions);
      const result = parse(schema, 'photo.jpg');
      expect(result).toBe('photo.jpg');
    });

    it('should accept file with uppercase extension', () => {
      const schema = fileNameWithExtension(allowedExtensions);
      const result = parse(schema, 'photo.JPG');
      expect(result).toBe('photo.JPG'); // No transformation
    });

    it('should reject file with disallowed extension', () => {
      const schema = fileNameWithExtension(allowedExtensions);
      const result = safeParse(schema, 'document.txt');
      expect(result.success).toBe(false);
    });

    it('should reject file ending with dot', () => {
      const schema = fileNameWithExtension(allowedExtensions);
      const result = safeParse(schema, 'filename.');
      expect(result.success).toBe(false);
    });

    it('should accept double extension if allowed', () => {
      const schema = fileNameWithExtension(['.tar.gz', '.zip']);
      const result = parse(schema, 'archive.tar.gz');
      expect(result).toBe('archive.tar.gz');
    });
  });

  describe('no transformation', () => {
    it('should preserve original filename case', () => {
      const schema = fileNameWithExtension(allowedExtensions);
      const result = parse(schema, 'MyPhoto.PNG');
      expect(result).toBe('MyPhoto.PNG');
    });

    it('should preserve spaces and special characters', () => {
      const schema = fileNameWithExtension(allowedExtensions);
      const result = parse(schema, 'My Photo (1).jpg');
      expect(result).toBe('My Photo (1).jpg');
    });
  });

  describe('custom error message', () => {
    it('should use custom error message', () => {
      const schema = fileNameWithExtension(['.pdf'], 'PDFs only');
      const result = safeParse(schema, 'file.txt');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues[0].message).toBe('PDFs only');
      }
    });
  });
});
