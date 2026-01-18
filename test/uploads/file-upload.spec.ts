import { describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '../../src/http/errors.js';
import { assertUploadPathOwnership, createUploadConfig } from '../../src/uploads/file-upload.js';

describe('createUploadConfig', () => {
  describe('happy path', () => {
    it('should create config with correct structure', () => {
      const result = createUploadConfig('avatars', ['user123'], 'photo.jpg');

      expect(result.dir).toMatch(/^uploads\/avatars\/user123\/[0-9a-f]{16}$/);
      expect(result.fileName).toBe('photo.jpg');
    });

    it('should include multiple IDs in path', () => {
      const result = createUploadConfig('documents', ['org1', 'project2'], 'doc.pdf');

      expect(result.dir).toMatch(/^uploads\/documents\/org1\/project2\/[0-9a-f]{16}$/);
      expect(result.fileName).toBe('doc.pdf');
    });

    it('should generate unique random IDs', () => {
      const result1 = createUploadConfig('test', ['id1'], 'file.txt');
      const result2 = createUploadConfig('test', ['id1'], 'file.txt');

      expect(result1.dir).not.toBe(result2.dir);
    });

    it('should handle single ID', () => {
      const result = createUploadConfig('logos', ['company1'], 'logo.png');

      expect(result.dir).toContain('uploads/logos/company1/');
    });

    it('should handle empty IDs array', () => {
      const result = createUploadConfig('global', [], 'asset.png');
      expect(result.dir).toMatch(/^uploads\/global\/[0-9a-f]{16}$/);
      expect(result.dir).not.toContain('//');
    });
  });

  describe('validation', () => {
    it('should throw BadRequestException for empty prefix', () => {
      expect(() => createUploadConfig('', ['id1'], 'file.txt')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for whitespace-only prefix', () => {
      expect(() => createUploadConfig('   ', ['id1'], 'file.txt')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty ID', () => {
      expect(() => createUploadConfig('avatars', [''], 'file.txt')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for ID with forward slash', () => {
      expect(() => createUploadConfig('avatars', ['user/123'], 'file.txt')).toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException for ID with backslash', () => {
      expect(() => createUploadConfig('avatars', ['user\\123'], 'file.txt')).toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException for ID with path traversal', () => {
      expect(() => createUploadConfig('avatars', ['..'], 'file.txt')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for ID containing ..', () => {
      expect(() => createUploadConfig('avatars', ['some..id'], 'file.txt')).toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException for non-string ID', () => {
      // @ts-expect-error Testing invalid input
      expect(() => createUploadConfig('avatars', [null], 'file.txt')).toThrow(BadRequestException);
    });
  });
});

describe('assertUploadPathOwnership', () => {
  describe('valid paths', () => {
    it('should not throw for valid ownership', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123/abc123/photo.jpg', 'avatars', [
          'user123',
        ])
      ).not.toThrow();
    });

    it('should not throw for path with multiple IDs', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/docs/org1/user2/abc123/file.pdf', 'docs', [
          'org1',
          'user2',
        ])
      ).not.toThrow();
    });

    it('should not throw for path with empty IDs', () => {
      // For empty IDs, the path format is uploads/{prefix}/{randomId}/{filename}
      expect(() =>
        assertUploadPathOwnership('/uploads/global/abc12345/file.png', 'global', [])
      ).not.toThrow();
    });
  });

  describe('invalid paths', () => {
    it('should throw ForbiddenException for wrong prefix', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/documents/user123/abc/file.pdf', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for wrong user ID', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user456/abc/photo.jpg', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for path not starting with /uploads/', () => {
      expect(() =>
        assertUploadPathOwnership('/other/avatars/user123/abc/photo.jpg', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for path with no filename', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123/abc/', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for path ending with directory', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123/', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });
  });

  describe('security', () => {
    it('should throw ForbiddenException for path traversal attempt', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123/../admin/file.txt', 'avatars', [
          'user123',
        ])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for encoded path traversal', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123/%2e%2e/admin/file.txt', 'avatars', [
          'user123',
        ])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for backslash in path', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123\\abc/file.txt', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for double slashes', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars//user123/abc/file.txt', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for very long paths', () => {
      const longPath = `/uploads/avatars/user123/${'a'.repeat(1025)}/file.txt`;
      expect(() => assertUploadPathOwnership(longPath, 'avatars', ['user123'])).toThrow(
        ForbiddenException
      );
    });

    it('should throw ForbiddenException for control characters', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123/abc\x00/file.txt', 'avatars', [
          'user123',
        ])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for invalid ID with forward slash', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user/123/abc/file.txt', 'avatars', ['user/123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for ./ in path', () => {
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123/./abc/file.txt', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if path decoding fails', () => {
      // Line 105 coverage: malformed URI sequence
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/%E0%A4%A', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if relative path is empty or invalid', () => {
      // Line 130 coverage implies we reach validateRelativePath
      // relativePath comes from slice(expectedPrefix.length)
      // So use a path strictly equal to expected prefix
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123/', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);

      // Or just empty characters/whitespace if possible
      expect(() =>
        assertUploadPathOwnership('/uploads/avatars/user123/   ', 'avatars', ['user123'])
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if validation of IDs fails', () => {
      // Line 76 coverage: id is not a string or empty
      expect(() =>
        // @ts-expect-error Testing invalid input
        assertUploadPathOwnership('/path', 'prefix', [null])
      ).toThrow(ForbiddenException);
    });
  });

  describe('custom error message', () => {
    it('should use custom error message', () => {
      expect(() =>
        assertUploadPathOwnership('/invalid/path', 'avatars', ['user123'], 'Custom error message')
      ).toThrow('Custom error message');
    });

    it('should use default error message when not provided', () => {
      expect(() => assertUploadPathOwnership('/invalid/path', 'avatars', ['user123'])).toThrow(
        'Invalid file path'
      );
    });
  });
});
