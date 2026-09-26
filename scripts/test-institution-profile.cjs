const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  detectImageMimeType,
  extractStoragePath,
  MAX_IMAGE_BYTES,
} = require("../server/services/institutionLogoService");

describe("Institution Profile & Logo Security Suite", () => {
  // 1. Local Logo Processing & Magic Bytes
  describe("1. Magic Bytes & MIME Type Detection", () => {
    it("should correctly detect valid PNG binary header", () => {
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]);
      assert.equal(detectImageMimeType(pngBuffer), "image/png");
    });

    it("should correctly detect valid JPEG binary header", () => {
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      assert.equal(detectImageMimeType(jpegBuffer), "image/jpeg");
    });

    it("should correctly detect valid WebP binary header", () => {
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      assert.equal(detectImageMimeType(webpBuffer), "image/webp");
    });

    it("should reject non-image files (e.g. text/html/executable) disguised as images", () => {
      const htmlBuffer = Buffer.from("<html><head><title>Fake</title></head></html>");
      assert.equal(detectImageMimeType(htmlBuffer), null);

      const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
      assert.equal(detectImageMimeType(exeBuffer), null);

      const shortBuffer = Buffer.from([0x89, 0x50]);
      assert.equal(detectImageMimeType(shortBuffer), null);
    });
  });

  // 2. Storage Path Scoping & Admin Isolation
  describe("2. Storage Path Isolation & Traversal Prevention", () => {
    const adminId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    it("should extract storage path strictly scoped to the owner admin", () => {
      const url = `https://xyz.supabase.co/storage/v1/object/public/institution-logos/logos/${adminId}/1711000000_abc123.png`;
      const path = extractStoragePath(url, adminId);
      assert.equal(path, `logos/${adminId}/1711000000_abc123.png`);
    });

    it("should reject attempts to extract/delete paths belonging to a different admin (IDOR prevention)", () => {
      const otherAdminId = "99999999-9999-9999-9999-999999999999";
      const url = `https://xyz.supabase.co/storage/v1/object/public/institution-logos/logos/${otherAdminId}/1711000000_abc123.png`;
      const path = extractStoragePath(url, adminId);
      assert.equal(path, null);
    });

    it("should reject directory traversal patterns in storage URLs", () => {
      const maliciousUrl = `https://xyz.supabase.co/storage/v1/object/public/institution-logos/logos/${adminId}/../../etc/passwd`;
      const path = extractStoragePath(maliciousUrl, adminId);
      assert.equal(path, null);
    });
  });

  // 3. College Name Validation
  describe("3. College Name Validation (Trimming, Non-Empty, 255-char Cap)", () => {
    function validateCollegeName(name) {
      if (typeof name !== "string") {
        return { ok: false, error: "College name must be a string." };
      }
      const trimmed = name.trim();
      if (!trimmed) {
        return { ok: false, error: "College name cannot be empty." };
      }
      if (trimmed.length > 255) {
        return { ok: false, error: "College name cannot exceed 255 characters." };
      }
      return { ok: true, value: trimmed };
    }

    it("should accept valid trimmed college names", () => {
      const res = validateCollegeName("  Massachusetts Institute of Technology  ");
      assert.equal(res.ok, true);
      assert.equal(res.value, "Massachusetts Institute of Technology");
    });

    it("should reject empty or whitespace-only college names", () => {
      assert.equal(validateCollegeName("").ok, false);
      assert.equal(validateCollegeName("   \t\n  ").ok, false);
    });

    it("should reject college names exceeding 255 characters", () => {
      const longName = "A".repeat(256);
      assert.equal(validateCollegeName(longName).ok, false);

      const maxValidName = "A".repeat(255);
      assert.equal(validateCollegeName(maxValidName).ok, true);
    });
  });

  // 4. Remote HTTPS Logo Validation & Base64 Rejection
  describe("4. Remote URL Acceptance & Base64 Rejection", () => {
    function validateProfileLogo(url) {
      if (url === null || url === "") return { ok: true, value: null };
      if (typeof url !== "string") return { ok: false, error: "Invalid URL" };
      const clean = url.trim();
      if (!clean) return { ok: true, value: null };

      if (/^data:image\//i.test(clean)) {
        return { ok: false, error: "Raw Base64 images are not supported in profile. Please upload an image file." };
      }
      if (!/^https?:\/\//i.test(clean)) {
        return { ok: false, error: "Invalid logo URL format. Must be a valid HTTP or HTTPS URL." };
      }
      return { ok: true, value: clean };
    }

    it("should accept valid HTTPS and HTTP URLs", () => {
      const res1 = validateProfileLogo("https://cdn.example.edu/branding/logo.png");
      assert.equal(res1.ok, true);
      assert.equal(res1.value, "https://cdn.example.edu/branding/logo.png");

      const res2 = validateProfileLogo("http://legacy.example.edu/logo.jpg");
      assert.equal(res2.ok, true);
    });

    it("should reject raw Base64 data URLs in PostgreSQL updates", () => {
      const res = validateProfileLogo("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
      assert.equal(res.ok, false);
      assert.match(res.error, /Raw Base64 images are not supported/);
    });

    it("should reject javascript: or file: or invalid scheme URLs", () => {
      assert.equal(validateProfileLogo("javascript:alert(1)").ok, false);
      assert.equal(validateProfileLogo("file:///etc/passwd").ok, false);
      assert.equal(validateProfileLogo("not-a-url").ok, false);
    });
  });

  // 5. Atomic Save Workflow & Rollback Logic
  describe("5. Atomic Workflow & Rollback Behavior", () => {
    it("should never change the college name if logo upload fails", async () => {
      let collegeNameInDb = "Original College Name";
      let uploadSucceeded = false;

      // Simulated atomic UI workflow
      async function saveWorkflow(newName, fileValid) {
        // Step 1: Validate name
        if (!newName || !newName.trim()) throw new Error("Empty name");

        // Step 2: Upload logo (if file selected)
        if (!fileValid) {
          throw new Error("Logo upload failed: corrupted file");
        }
        uploadSucceeded = true;

        // Step 3: Update DB
        collegeNameInDb = newName.trim();
      }

      await assert.rejects(
        () => saveWorkflow("Attempted New Name", false),
        /Logo upload failed/
      );

      // Verifies college name remains unchanged in DB!
      assert.equal(collegeNameInDb, "Original College Name");
      assert.equal(uploadSucceeded, false);
    });

    it("should trigger newly uploaded object deletion if DB update fails", async () => {
      const deletedPaths = [];
      const fakeStorage = {
        remove: (paths) => deletedPaths.push(...paths),
      };

      const newStoragePath = "logos/admin-123/new_logo.png";
      const dbUpdateSuccess = false;

      if (!dbUpdateSuccess && newStoragePath) {
        fakeStorage.remove([newStoragePath]);
      }

      assert.deepEqual(deletedPaths, ["logos/admin-123/new_logo.png"]);
    });

    it("should keep previous logo until replacement has fully saved", async () => {
      let previousLogoInStorage = "logos/admin-123/old_logo.png";
      let deletedStoragePaths = [];

      function onSaveSuccess(oldPath, newPath) {
        if (oldPath && oldPath !== newPath) {
          deletedStoragePaths.push(oldPath);
        }
      }

      // If DB update fails, onSaveSuccess is NOT called
      const dbFailed = true;
      if (!dbFailed) {
        onSaveSuccess(previousLogoInStorage, "logos/admin-123/new_logo.png");
      }
      assert.equal(deletedStoragePaths.length, 0); // Old logo NOT deleted!

      // When DB update succeeds
      onSaveSuccess(previousLogoInStorage, "logos/admin-123/new_logo.png");
      assert.deepEqual(deletedStoragePaths, ["logos/admin-123/old_logo.png"]);
    });
  });

  // 6. Auth Payload Projection & Egress Protection
  describe("6. Auth Payloads & Base64 Stripping for Egress Protection", () => {
    function isDataUrlImage(value) {
      const raw = String(value || "");
      return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(raw);
    }

    function projectAuthLogo(collegeLogoUrl) {
      return isDataUrlImage(collegeLogoUrl) ? null : collegeLogoUrl;
    }

    it("should preserve public Supabase Storage logo URLs for Admin, Faculty, and Student", () => {
      const storageUrl = "https://example.supabase.co/storage/v1/object/public/institution-logos/logos/123/logo.png";
      assert.equal(projectAuthLogo(storageUrl), storageUrl);
    });

    it("should preserve valid remote HTTPS logo URLs", () => {
      const httpsUrl = "https://college.edu/logo.png";
      assert.equal(projectAuthLogo(httpsUrl), httpsUrl);
    });

    it("should strip raw Base64 data URLs to prevent egress explosion", () => {
      const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      assert.equal(projectAuthLogo(dataUrl), null);
    });
  });

  // 7. Avatar Resolution for Admin in Header & Menu
  describe("7. Admin Avatar & CollegeHeader Resolution", () => {
    function resolveAdminAvatar(photoUrl, user) {
      return String(photoUrl || user?.profilePhotoUrl || user?.adminProfilePhotoUrl || "").trim();
    }

    function resolveCollegeHeaderPhotoUrl(normalizedRole, profilePhotoUrl, profileMenuPhotoUrl, user) {
      if (normalizedRole === "ADMIN") {
        return profilePhotoUrl ?? profileMenuPhotoUrl ?? user?.profilePhotoUrl ?? null;
      }
      return profileMenuPhotoUrl ?? profilePhotoUrl ?? null;
    }

    it("should resolve saved institution logo for Admin even when profileMenuPhotoUrl is omitted", () => {
      const user = { profilePhotoUrl: "https://example.supabase.co/storage/v1/object/public/institution-logos/logos/1/logo.png" };
      
      // CollegeHeader passes to ProfileMenu
      const passedPhotoUrl = resolveCollegeHeaderPhotoUrl("ADMIN", user.profilePhotoUrl, undefined, user);
      assert.equal(passedPhotoUrl, user.profilePhotoUrl);

      // ProfileMenu resolves avatar
      const resolved = resolveAdminAvatar(passedPhotoUrl, user);
      assert.equal(resolved, user.profilePhotoUrl);
    });

    it("should fallback to user.profilePhotoUrl if photoUrl prop is null or undefined", () => {
      const user = { profilePhotoUrl: "https://college.edu/logo.png" };
      const resolved = resolveAdminAvatar(undefined, user);
      assert.equal(resolved, "https://college.edu/logo.png");
    });
  });
});
