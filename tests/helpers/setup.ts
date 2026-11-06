// Runs before every unit test file (see setupFiles in vitest.config.mts).
// Testing Library only unmounts rendered components after each test by itself when Vitest
// globals are on; they aren't, so do it here. A no-op for tests that render nothing.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
