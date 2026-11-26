package com.shinjin.pop.planning;

import com.shinjin.pop.output.SyntheticOutput;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import synthetic.planning.PlanningDomain;
import synthetic.planning.PlanningDomain.*;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/planning/output")
public final class PlanningOutputController {
    private final PlanningDomain planning;
    private final SyntheticOutput renderer;

    public PlanningOutputController(PlanningDemoController planning, SyntheticOutput renderer) {
        this.planning = planning.domain();
        this.renderer = renderer;
    }

    public record Artifact(PlanOutput report, byte[] pdf) {}

    @PostMapping("/preview")
    public ResponseEntity<?> preview(HttpServletRequest request, @RequestBody PlanOutputSelection selection) {
        var reply = planning.previewOutput(PlanningDemoController.actor(request), selection);
        if (reply.status() != 200) return fail(reply.status(), reply.error());
        var rendered = render(reply.value());
        return artifact(reply.value(), rendered);
    }

    @PostMapping("/execute")
    public ResponseEntity<?> execute(HttpServletRequest request, @RequestBody PlanOutputCommand command) {
        var actor = PlanningDemoController.actor(request);
        var prepared = planning.prepareOutput(actor, command);
        if (prepared.status() != 200) return fail(prepared.status(), prepared.error());
        var rendered = render(prepared.value());
        if (rendered.pdf() == null) return fail(503, rendered.contract().status());
        var result = planning.executeOutput(actor, command);
        return result.status() == 200 ? artifact(result.value(), rendered) : fail(result.status(), result.error());
    }

    public SyntheticOutput.Output render(PlanOutput report) {
        return renderer.renderPlan(report.mode() == OutputMode.MULTIPLE, report.branch() == Branch.SPEC_CHANGE,
                report.rows().stream().map(row -> new SyntheticOutput.PlanDocumentRow(
                        row.plan().date() + "-" + row.plan().sequence(), order(row.originalOrder()), order(row.issuedOrder()),
                        row.item(), row.quantity())).toList());
    }

    private static String order(OrderKey key) {
        return key.number() + "/" + key.history() + "/" + key.line();
    }

    private static ResponseEntity<?> artifact(PlanOutput report, SyntheticOutput.Output rendered) {
        return rendered.pdf() == null ? fail(503, rendered.contract().status())
                : ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Artifact(report, rendered.pdf()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<?> session(ResponseStatusException error) {
        return fail(error.getStatusCode().value(), "LOGIN_REQUIRED");
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> malformed() { return fail(400, "MALFORMED_COMMAND"); }

    private static ResponseEntity<?> fail(int status, String code) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new PlanningDemoController.Failure(code));
    }
}
