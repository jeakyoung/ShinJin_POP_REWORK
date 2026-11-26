package com.shinjin.pop.history;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("demo")
public class WorkplaceClockController {
    private static final DateTimeFormatter DEMO_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final ZoneId PLANT_ZONE = ZoneId.of("Asia/Seoul");

    public record WorkplaceTime(String date1) {}

    @GetMapping("/api/pop/workplace/time")
    public ResponseEntity<WorkplaceTime> time(HttpServletRequest request) {
        DemoSessionController.requireIdentity(request);
        String date1 = LocalDateTime.now(PLANT_ZONE).format(DEMO_FORMAT);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new WorkplaceTime(date1));
    }
}
