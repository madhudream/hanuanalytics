// The lazily loaded recording bundle: rrweb's record() exposed as window.__hanuRecord.
import { record } from "@rrweb/record";

(window as unknown as { __hanuRecord: unknown }).__hanuRecord = record;
